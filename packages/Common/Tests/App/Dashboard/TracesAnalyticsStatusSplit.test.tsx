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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Traces > Analytics split by Status (#4118).
 *
 * The analytics view colored every split by position in its palette. Split
 * by Status, whichever status came back first was drawn indigo, the next pink
 * and the third green, so rows that arrived Unset, Ok, Error drew Error green.
 * The legend also called OpenTelemetry's default status a bare "Unset".
 *
 * Now a split by Status alone keeps each status's own color (Unset #10b981,
 * Ok #0891b2, Error #ef4444) in the legend, the bars, the lines, the area and
 * the top list, whatever order the rows arrive in, and names Unset
 * "Unset (no error)". A split by anything else, and Status crossed with a
 * second dimension, still color by position exactly as before.
 *
 * This mounts the real TracesAnalyticsView against a mocked analytics
 * endpoint, as TracesAnalyticsSeriesLabels.test.tsx does. recharts is
 * replaced by probes that print each series' data key and the color it is
 * drawn in; jsdom has no layout, so the real charts would draw nothing to
 * read.
 */

const apiPostMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("recharts", () => {
  const ReactInFactory: typeof React = jest.requireActual(
    "react",
  ) as typeof React;

  /*
   * A chart prints the rows it is handed. Its children are drawn inside an
   * <svg>, so the area's gradient <stop>s are real SVG elements to read.
   */
  const chart: (testId: string) => (props: any) => React.ReactElement = (
    testId: string,
  ) => {
    return (props: any): React.ReactElement => {
      return ReactInFactory.createElement(
        "div",
        { "data-testid": testId, "data-rows": JSON.stringify(props.data) },
        ReactInFactory.createElement("svg", null, props.children),
      );
    };
  };

  // A series prints its kind, its data key and the colors it is drawn in.
  const series: (kind: string) => (props: any) => React.ReactElement = (
    kind: string,
  ) => {
    return (props: any): React.ReactElement => {
      return ReactInFactory.createElement("g", {
        "data-testid": "chart-series",
        "data-kind": kind,
        "data-key": props.dataKey,
        "data-stroke": props.stroke,
        "data-fill": props.fill,
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
    Bar: series("bar"),
    Line: series("line"),
    Area: series("area"),
    CartesianGrid: nothing,
    XAxis: nothing,
    YAxis: nothing,
    Tooltip: nothing,
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
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

import TracesAnalyticsView from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView";
import { getSpanStatusPresentation } from "../../../../App/FeatureSet/Dashboard/src/Utils/SpanStatusPresentation";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

const FIRST_MINUTE: string = "2026-09-28T10:00:00.000Z";
const SECOND_MINUTE: string = "2026-09-28T10:01:00.000Z";

const UNSET_COLOR: string = "#10b981";
// Cyan: it stays apart from Error's red for colorblind readers too.
const OK_COLOR: string = "#0891b2";
const ERROR_COLOR: string = "#ef4444";

/*
 * TracesAnalyticsView's palette: what the first three series of any other
 * split get, by position. The third happens to be the Unset green.
 */
const BY_POSITION: [string, string, string] = ["#6366f1", "#ec4899", "#10b981"];

// Its muted twins, as jsdom reads them back from the top list's bars.
const MUTED_BY_POSITION: [string, string, string] = [
  "rgba(99, 102, 241, 0.15)",
  "rgba(236, 72, 153, 0.15)",
  "rgba(16, 185, 129, 0.15)",
];

type ToRgbFunction = (hex: string) => string;

type HexChannelsFunction = (hex: string) => Array<number>;

const hexChannels: HexChannelsFunction = (hex: string): Array<number> => {
  return [1, 3, 5].map((start: number): number => {
    return parseInt(hex.substring(start, start + 2), 16);
  });
};

// How jsdom reads a six-digit hex color back from an inline style.
const toRgb: ToRgbFunction = (hex: string): string => {
  return `rgb(${hexChannels(hex).join(", ")})`;
};

/*
 * How jsdom reads back a status color with the "26" alpha suffix the top list
 * appends for its muted bar: 0x26 / 255 = 0.149, the 8-bit alpha nearest the
 * palette's 15%.
 */
const toMutedRgba: ToRgbFunction = (hex: string): string => {
  return `rgba(${hexChannels(hex).join(", ")}, 0.149)`;
};

interface TimeseriesRow {
  time: string;
  value: number;
  groupValues: Record<string, string>;
}

interface TopItem {
  value: string;
  metricValue: number;
  count: number;
}

interface TableRow {
  groupValues: Record<string, string>;
  count: number;
  errorCount: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p90DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
}

interface AnalyticsRequestData {
  chartType: string;
  metric: string;
  groupBy?: Array<string> | undefined;
}

interface AnalyticsRequest {
  data: AnalyticsRequestData;
}

type RowFunction = (
  time: string,
  groupValues: Record<string, string>,
  value: number,
) => TimeseriesRow;

const row: RowFunction = (
  time: string,
  groupValues: Record<string, string>,
  value: number,
): TimeseriesRow => {
  return { time, value, groupValues };
};

type TableRowFunction = (
  groupValues: Record<string, string>,
  count: number,
) => TableRow;

const tableRow: TableRowFunction = (
  groupValues: Record<string, string>,
  count: number,
): TableRow => {
  return {
    groupValues,
    count,
    errorCount: groupValues["statusCode"] === "2" ? count : 0,
    avgDurationMs: 1,
    p50DurationMs: 1,
    p90DurationMs: 1,
    p95DurationMs: 1,
    p99DurationMs: 1,
    minDurationMs: 1,
    maxDurationMs: 1,
  };
};

/*
 * What the mocked endpoint answers, per chart type and split: the groupBy
 * fields joined by "+", "" when there is none.
 */
let timeseriesBySplit: Record<string, Array<TimeseriesRow>> = {};
let topListBySplit: Record<string, Array<TopItem>> = {};
let tableBySplit: Record<string, Array<TableRow>> = {};

// The status top list, slowest first: here that puts Error on top.
const STATUS_TOP_LIST: Array<TopItem> = [
  { value: "2", metricValue: 950, count: 12 },
  { value: "0", metricValue: 120, count: 400 },
  { value: "1", metricValue: 80, count: 30 },
];

const installAnalyticsData: () => void = (): void => {
  timeseriesBySplit = {
    "": [row(FIRST_MINUTE, {}, 120), row(SECOND_MINUTE, {}, 110)],
    name: [
      row(FIRST_MINUTE, { name: "GET /checkout" }, 9),
      row(FIRST_MINUTE, { name: "POST /cart" }, 4),
      row(FIRST_MINUTE, { name: "GET /health" }, 2),
    ],
    // Unset, Ok, Error: by position Error took the palette's green.
    statusCode: [
      row(FIRST_MINUTE, { statusCode: "0" }, 40),
      row(FIRST_MINUTE, { statusCode: "1" }, 5),
      row(FIRST_MINUTE, { statusCode: "2" }, 3),
      row(SECOND_MINUTE, { statusCode: "0" }, 35),
      row(SECOND_MINUTE, { statusCode: "2" }, 1),
    ],
    "statusCode+name": [
      row(FIRST_MINUTE, { statusCode: "2", name: "GET /checkout" }, 2),
      row(FIRST_MINUTE, { statusCode: "0", name: "GET /checkout" }, 30),
      row(FIRST_MINUTE, { statusCode: "0", name: "POST /cart" }, 12),
    ],
  };

  topListBySplit = {
    name: [
      { value: "GET /checkout", metricValue: 50, count: 50 },
      { value: "POST /cart", metricValue: 20, count: 20 },
      { value: "GET /health", metricValue: 5, count: 5 },
    ],
    statusCode: STATUS_TOP_LIST,
    // The server ranks a top list by its first dimension only.
    "statusCode+name": STATUS_TOP_LIST,
  };

  tableBySplit = {
    name: [tableRow({ name: "GET /checkout" }, 50)],
    statusCode: [
      tableRow({ statusCode: "2" }, 12),
      tableRow({ statusCode: "0" }, 400),
      tableRow({ statusCode: "1" }, 30),
    ],
  };

  apiPostMock.mockImplementation(async (request: AnalyticsRequest) => {
    const split: string = (request.data.groupBy || []).join("+");
    const byChart: Record<string, Record<string, Array<unknown>>> = {
      timeseries: timeseriesBySplit,
      toplist: topListBySplit,
      table: tableBySplit,
    };
    return { data: { data: byChart[request.data.chartType]?.[split] || [] } };
  });
};

const renderView: () => void = (): void => {
  render(
    <TracesAnalyticsView
      baseFilters={{}}
      attributeKeys={[]}
      serviceNameMap={{}}
    />,
  );
};

type ChooseFunction = (caption: string, value: string) => void;

// Picks an option of the query-builder control with this caption.
const choose: ChooseFunction = (caption: string, value: string): void => {
  const select: HTMLSelectElement = screen.getByText(caption)
    .nextElementSibling as HTMLSelectElement;
  fireEvent.change(select, { target: { value } });
  // An option the control does not offer would silently pick "".
  expect(select.value).toBe(value);
};

const lastRequest: () => AnalyticsRequestData = (): AnalyticsRequestData => {
  const calls: Array<Array<unknown>> = apiPostMock.mock.calls;
  return (calls[calls.length - 1]![0] as AnalyticsRequest).data;
};

interface LegendEntry {
  label: string;
  color: string;
}

// The timeseries legend, in order: each swatch and the label beside it.
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

interface DrawnSeries {
  kind: string | null;
  key: string | null;
  color: string | null;
}

// Every Bar, Line or Area drawn, in order, with its fill or stroke.
const drawnSeries: () => Array<DrawnSeries> = (): Array<DrawnSeries> => {
  return screen
    .queryAllByTestId("chart-series")
    .map((element: HTMLElement): DrawnSeries => {
      const kind: string | null = element.getAttribute("data-kind");
      return {
        kind,
        key: element.getAttribute("data-key"),
        color: element.getAttribute(
          kind === "bar" ? "data-fill" : "data-stroke",
        ),
      };
    });
};

// The stop colors of the area's gradient.
const gradientStops: () => Array<string | null> = (): Array<string | null> => {
  return Array.from(
    document.body.querySelectorAll("#traceAnalyticsArea stop"),
  ).map((stop: Element): string | null => {
    return stop.getAttribute("stop-color");
  });
};

interface TopListRow {
  label: string;
  dot: string;
  bar: string;
  edge: string;
}

/*
 * The top list, in rank order: each row's label, its dot, its bar's muted
 * fill and the bar's solid left edge.
 */
const topListRows: () => Array<TopListRow> = (): Array<TopListRow> => {
  return Array.from(
    document.body.querySelectorAll<HTMLElement>('div[style*="border-left"]'),
  ).map((bar: HTMLElement): TopListRow => {
    const label: Element =
      bar.parentElement!.parentElement!.previousElementSibling!;
    const dot: HTMLElement = label.previousElementSibling as HTMLElement;
    return {
      label: label.textContent || "",
      dot: dot.style.backgroundColor,
      bar: bar.style.backgroundColor,
      edge: bar.style.borderLeft,
    };
  });
};

type StatusTopListRowFunction = (label: string, color: string) => TopListRow;

const statusTopListRow: StatusTopListRowFunction = (
  label: string,
  color: string,
): TopListRow => {
  return {
    label,
    dot: toRgb(color),
    bar: toMutedRgba(color),
    edge: `3px solid ${color}`,
  };
};

describe("Traces Analytics split by Status keeps each status's color", () => {
  beforeEach(() => {
    getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
    getListMock.mockImplementation(async () => {
      return { data: [], count: 0 };
    });
    installAnalyticsData();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test("the colors pinned here are the shared module's", () => {
    expect(getSpanStatusPresentation(SpanStatus.Unset).color).toBe(UNSET_COLOR);
    expect(getSpanStatusPresentation(SpanStatus.Ok).color).toBe(OK_COLOR);
    expect(getSpanStatusPresentation(SpanStatus.Error).color).toBe(ERROR_COLOR);
  });

  test("REGRESSION: a count chart split by Status paints Error red, Unset green and Ok cyan, not palette colors by position", async () => {
    renderView();
    choose("Split by", "statusCode");

    // By position these were #6366f1, #ec4899 and #10b981: Error green.
    await waitFor(() => {
      expect(legendEntries()).toEqual([
        { label: "Unset (no error)", color: toRgb(UNSET_COLOR) },
        { label: "Ok", color: toRgb(OK_COLOR) },
        { label: "Error", color: toRgb(ERROR_COLOR) },
      ]);
    });
    expect(drawnSeries()).toEqual([
      { kind: "bar", key: "Unset (no error)", color: UNSET_COLOR },
      { kind: "bar", key: "Ok", color: OK_COLOR },
      { kind: "bar", key: "Error", color: ERROR_COLOR },
    ]);

    // The bars still find their values under the same labels.
    expect(
      JSON.parse(
        screen.getByTestId("bar-chart").getAttribute("data-rows") || "[]",
      ),
    ).toEqual([
      { time: FIRST_MINUTE, "Unset (no error)": 40, Ok: 5, Error: 3 },
      { time: SECOND_MINUTE, "Unset (no error)": 35, Error: 1 },
    ]);

    // Only the display changed: the request still splits by the stored column.
    expect(lastRequest().groupBy).toEqual(["statusCode"]);
    expect(screen.queryByText("Unset")).not.toBeInTheDocument();
  });

  test("REGRESSION: rows that come back Error first still draw Error red and Unset green", async () => {
    timeseriesBySplit["statusCode"] = [
      row(FIRST_MINUTE, { statusCode: "2" }, 7),
      row(FIRST_MINUTE, { statusCode: "0" }, 90),
      row(FIRST_MINUTE, { statusCode: "1" }, 4),
    ];

    renderView();
    choose("Split by", "statusCode");

    // By position Error would have taken #6366f1 and Unset #ec4899.
    await waitFor(() => {
      expect(legendEntries()).toEqual([
        { label: "Error", color: toRgb(ERROR_COLOR) },
        { label: "Unset (no error)", color: toRgb(UNSET_COLOR) },
        { label: "Ok", color: toRgb(OK_COLOR) },
      ]);
    });
    expect(drawnSeries()).toEqual([
      { kind: "bar", key: "Error", color: ERROR_COLOR },
      { kind: "bar", key: "Unset (no error)", color: UNSET_COLOR },
      { kind: "bar", key: "Ok", color: OK_COLOR },
    ]);
  });

  test("REGRESSION: a duration chart split by Status draws one line per status in its status's color", async () => {
    renderView();
    choose("Measure", "p90Duration");
    choose("Split by", "statusCode");

    await waitFor(() => {
      expect(drawnSeries()).toEqual([
        { kind: "line", key: "Unset (no error)", color: UNSET_COLOR },
        { kind: "line", key: "Ok", color: OK_COLOR },
        { kind: "line", key: "Error", color: ERROR_COLOR },
      ]);
    });
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    expect(legendEntries()).toEqual([
      { label: "Unset (no error)", color: toRgb(UNSET_COLOR) },
      { label: "Ok", color: toRgb(OK_COLOR) },
      { label: "Error", color: toRgb(ERROR_COLOR) },
    ]);
  });

  test("REGRESSION: a duration chart left with one status draws its area, gradient included, in that status's color", async () => {
    timeseriesBySplit["statusCode"] = [
      row(FIRST_MINUTE, { statusCode: "2" }, 950),
      row(SECOND_MINUTE, { statusCode: "2" }, 870),
    ];

    renderView();
    choose("Measure", "p90Duration");
    choose("Split by", "statusCode");

    // It used to take the palette's first color, #6366f1.
    await waitFor(() => {
      expect(drawnSeries()).toEqual([
        { kind: "area", key: "Error", color: ERROR_COLOR },
      ]);
    });
    expect(gradientStops()).toEqual([ERROR_COLOR, ERROR_COLOR]);
    expect(screen.getByTestId("chart-series").getAttribute("data-fill")).toBe(
      "url(#traceAnalyticsArea)",
    );
    // One series draws no legend.
    expect(legendEntries()).toEqual([]);
  });

  test("an unsplit duration chart keeps the palette's first color", async () => {
    renderView();
    choose("Measure", "p90Duration");
    choose("Split by", "");

    await waitFor(() => {
      expect(drawnSeries()).toEqual([
        { kind: "area", key: "P90 Response Time", color: BY_POSITION[0] },
      ]);
    });
    expect(gradientStops()).toEqual([BY_POSITION[0], BY_POSITION[0]]);
    expect(lastRequest().groupBy).toBeUndefined();
  });

  test("REGRESSION: a top list split by Status paints each row's dot, bar edge and muted bar in its status's color", async () => {
    renderView();
    choose("Chart", "toplist");
    choose("Measure", "p99Duration");
    choose("Split by", "statusCode");

    // By position: #6366f1, #ec4899, #10b981 over their 15% palette twins.
    await waitFor(() => {
      expect(topListRows()).toEqual([
        statusTopListRow("Error", ERROR_COLOR),
        statusTopListRow("Unset (no error)", UNSET_COLOR),
        statusTopListRow("Ok", OK_COLOR),
      ]);
    });
    // Ok's row spelled out, as jsdom reads it: cyan over its 15% twin.
    expect(topListRows()[2]).toEqual({
      label: "Ok",
      dot: "rgb(8, 145, 178)",
      bar: "rgba(8, 145, 178, 0.149)",
      edge: "3px solid #0891b2",
    });
    expect(lastRequest().groupBy).toEqual(["statusCode"]);
  });

  test("REGRESSION: a top list keeps the status colors when a second dimension is left over from the timeseries", async () => {
    renderView();
    choose("Split by", "statusCode");
    choose("then by", "name");
    await waitFor(() => {
      expect(legendEntries()[0]?.label).toBe("Error / GET /checkout");
    });

    // The top list hides "then by" and ranks by the first dimension only.
    choose("Chart", "toplist");

    await waitFor(() => {
      expect(topListRows()).toEqual([
        statusTopListRow("Error", ERROR_COLOR),
        statusTopListRow("Unset (no error)", UNSET_COLOR),
        statusTopListRow("Ok", OK_COLOR),
      ]);
    });
    expect(lastRequest().groupBy).toEqual(["statusCode", "name"]);
    expect(screen.queryByText("then by")).not.toBeInTheDocument();
  });

  test("REGRESSION: the table names Unset 'Unset (no error)', like the chart and the top list", async () => {
    renderView();
    choose("Chart", "table");
    choose("Split by", "statusCode");

    await waitFor(() => {
      expect(
        Array.from(document.body.querySelectorAll("tbody tr")).map(
          (tableRowElement: Element): string => {
            return tableRowElement.children[1]?.textContent || "";
          },
        ),
      ).toEqual(["Error", "Unset (no error)", "Ok"]);
    });
    expect(
      screen.getByRole("columnheader", { name: "Status" }),
    ).toBeInTheDocument();
  });
});

describe("every other split keeps its palette colors by position", () => {
  beforeEach(() => {
    getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
    getListMock.mockImplementation(async () => {
      return { data: [], count: 0 };
    });
    installAnalyticsData();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test("a split by span name is colored by position, exactly as before", async () => {
    renderView();

    await waitFor(() => {
      expect(legendEntries()).toEqual([
        { label: "GET /checkout", color: toRgb(BY_POSITION[0]) },
        { label: "POST /cart", color: toRgb(BY_POSITION[1]) },
        { label: "GET /health", color: toRgb(BY_POSITION[2]) },
      ]);
    });
    expect(drawnSeries()).toEqual([
      { kind: "bar", key: "GET /checkout", color: BY_POSITION[0] },
      { kind: "bar", key: "POST /cart", color: BY_POSITION[1] },
      { kind: "bar", key: "GET /health", color: BY_POSITION[2] },
    ]);
    expect(lastRequest().groupBy).toEqual(["name"]);
  });

  test("Status crossed with span name is colored by position, since several series share a status", async () => {
    renderView();
    choose("Split by", "statusCode");
    choose("then by", "name");

    // The colors are the old ones; only Unset's name changed.
    await waitFor(() => {
      expect(legendEntries()).toEqual([
        { label: "Error / GET /checkout", color: toRgb(BY_POSITION[0]) },
        {
          label: "Unset (no error) / GET /checkout",
          color: toRgb(BY_POSITION[1]),
        },
        {
          label: "Unset (no error) / POST /cart",
          color: toRgb(BY_POSITION[2]),
        },
      ]);
    });
    expect(drawnSeries()).toEqual([
      { kind: "bar", key: "Error / GET /checkout", color: BY_POSITION[0] },
      {
        kind: "bar",
        key: "Unset (no error) / GET /checkout",
        color: BY_POSITION[1],
      },
      {
        kind: "bar",
        key: "Unset (no error) / POST /cart",
        color: BY_POSITION[2],
      },
    ]);
    expect(lastRequest().groupBy).toEqual(["statusCode", "name"]);
  });

  test("a duration chart crossed the same way draws its lines by position", async () => {
    renderView();
    choose("Measure", "p90Duration");
    choose("Split by", "statusCode");
    choose("then by", "name");

    // The colors are the old ones; only Unset's name changed.
    await waitFor(() => {
      expect(drawnSeries()).toEqual([
        { kind: "line", key: "Error / GET /checkout", color: BY_POSITION[0] },
        {
          kind: "line",
          key: "Unset (no error) / GET /checkout",
          color: BY_POSITION[1],
        },
        {
          kind: "line",
          key: "Unset (no error) / POST /cart",
          color: BY_POSITION[2],
        },
      ]);
    });
  });

  test("a top list split by span name keeps the palette and its muted twins by position", async () => {
    renderView();
    choose("Chart", "toplist");

    await waitFor(() => {
      expect(topListRows()).toEqual([
        {
          label: "GET /checkout",
          dot: toRgb(BY_POSITION[0]),
          bar: MUTED_BY_POSITION[0],
          edge: `3px solid ${BY_POSITION[0]}`,
        },
        {
          label: "POST /cart",
          dot: toRgb(BY_POSITION[1]),
          bar: MUTED_BY_POSITION[1],
          edge: `3px solid ${BY_POSITION[1]}`,
        },
        {
          label: "GET /health",
          dot: toRgb(BY_POSITION[2]),
          bar: MUTED_BY_POSITION[2],
          edge: `3px solid ${BY_POSITION[2]}`,
        },
      ]);
    });
    expect(lastRequest().groupBy).toEqual(["name"]);
  });
});
