import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import DashboardTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTableComponent";
import DashboardTraceTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceTableComponent";
import DashboardSecurityEventsListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSecurityEventsListComponent";
import DashboardDataSourceTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceTableComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import { getDashboardWidgetSortHeaderTestId } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetSortCopy";
import DashboardTableComponent, {
  TableColumnKind,
} from "../../../Types/Dashboard/DashboardComponents/DashboardTableComponent";
import DashboardTraceTableComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTraceTableComponent";
import DashboardSecurityEventsListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardSecurityEventsListComponent";
import DashboardDataSourceTableComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceTableComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import {
  DashboardWidgetSortColumns,
  DashboardWidgetSortDirection,
  DashboardWidgetSortKind,
} from "../../../Types/Dashboard/DashboardWidgetSort";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DataSourceTableResult, {
  DataSourceTableColumnType,
} from "../../../Types/DataSource/DataSourceTableResult";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * Click-to-sort on the dashboard's table widgets (issue #5082), read
 * through the real widgets:
 *
 *   - A metric Table holds every row of its window, so it sorts them
 *     itself, before it trims to Max Rows; its columns are its own (the
 *     group-by attributes or the time, then every shown metric).
 *   - A Data Source Table sorts the rows its query returned; with no sort
 *     it keeps the query's order.
 *   - A Trace Table's rows are groups ClickHouse ranks: the column goes to
 *     the server (`tableSort`), which ranks the groups by it before the top
 *     limit. A resource dimension's group column does not sort.
 *   - The security events list sorts in ClickHouse by time, severity,
 *     class or host; the message is free text and does not sort.
 *
 * In the widget settings' preview, a header click sets the widget's own
 * sort, and a widget whose columns are its own reports them for the Sort
 * setting.
 */

type FetchResults = (data: unknown) => Promise<Array<AggregatedResult>>;
type ApiPost = (data: {
  url: unknown;
  data: JSONObject;
}) => Promise<{ data: JSONObject }>;
type AnalyticsGetList = (request: {
  query: JSONObject;
  sort: JSONObject;
  limit: number;
}) => Promise<{ data: Array<JSONObject>; count: number }>;
type FetchTable = (data: unknown) => Promise<DataSourceTableResult>;

const fetchResultsMock: Mock<FetchResults> = jest.fn<FetchResults>();
const apiPostMock: Mock<ApiPost> = jest.fn<ApiPost>();
const analyticsGetListMock: Mock<AnalyticsGetList> =
  jest.fn<AnalyticsGetList>();
const fetchTableMock: Mock<FetchTable> = jest.fn<FetchTable>();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (data: unknown) => {
          return fetchResultsMock(data);
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (data: { url: unknown; data: JSONObject }) => {
        return apiPostMock(data);
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

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: {
        query: JSONObject;
        sort: JSONObject;
        limit: number;
      }) => {
        return analyticsGetListMock(request);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/DataSourceQuery",
  () => {
    return {
      __esModule: true,
      default: {
        fetchTable: (data: unknown) => {
          return fetchTableMock(data);
        },
      },
    };
  },
);

const DASHBOARD_ID: string = "d0000000-0000-4000-8000-0000000000aa";
const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-0000000000bb",
);
const PICK_KEY: string = `oneuptime-dashboard-widget-sort-${COMPONENT_ID.toString()}:${DASHBOARD_ID}`;

// A security event's time ends in its time of day, seconds and all.
const TIME_OF_DAY_WITH_SECONDS: RegExp = /\d{1,2}:\d{2}:\d{2}/;

const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-10-19T10:00:00.000Z"),
    new Date("2026-10-19T11:00:00.000Z"),
  ),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

function baseProps(
  overrides: Partial<DashboardBaseComponentProps> = {},
): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "table-widget",
    onComponentUpdate: (): void => {},
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 400,
    dashboardComponentWidthInPx: 800,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    dashboardId: DASHBOARD_ID,
    ...overrides,
  };
}

function sortButton(columnKey: string): HTMLElement {
  return screen.getByTestId(getDashboardWidgetSortHeaderTestId(columnKey));
}

function headerCell(columnKey: string): HTMLElement {
  return sortButton(columnKey).closest("th") as HTMLElement;
}

// The first cell of each body row, in the order drawn.
function firstCells(): Array<string> {
  return Array.from(document.querySelectorAll("tbody tr")).map(
    (row: Element): string => {
      const cells: Array<Element> = Array.from(row.querySelectorAll("td"));
      return (cells[0]?.textContent || "").trim();
    },
  );
}

// The second cell of each body row (a trace table's first is its rank).
function secondCells(): Array<string> {
  return Array.from(document.querySelectorAll("tbody tr")).map(
    (row: Element): string => {
      const cells: Array<Element> = Array.from(row.querySelectorAll("td"));
      return (cells[1]?.textContent || "").trim();
    },
  );
}

beforeEach(() => {
  fetchResultsMock.mockReset();
  apiPostMock.mockReset();
  analyticsGetListMock.mockReset();
  fetchTableMock.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("a metric table grouped by an attribute", () => {
  const SERVICE_ERRORS: Array<[string, number]> = [
    ["checkout", 12],
    ["search", 3],
    ["billing", 41],
    ["auth", 7],
  ];

  function point(service: string, value: number): AggregatedModel {
    return {
      timestamp: new Date("2026-10-19T10:30:00.000Z"),
      value,
      attributes: { "service.name": service },
    } as unknown as AggregatedModel;
  }

  function tableComponent(
    widgetArguments: JSONObject = {},
  ): DashboardTableComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: DashboardComponentType.Table,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 8,
      heightInDashboardUnits: 6,
      minWidthInDashboardUnits: 4,
      minHeightInDashboardUnits: 3,
      arguments: {
        columns: [
          {
            id: "errors",
            variable: "a",
            header: "Errors",
            kind: TableColumnKind.Metric,
            metricName: "http.server.errors",
            aggregation: MetricsAggregationType.Sum,
          },
        ],
        groupByAttributes: [{ key: "service.name", header: "Service" }],
        maxRows: 25,
        ...widgetArguments,
      } as DashboardTableComponent["arguments"],
    };
  }

  beforeEach(() => {
    fetchResultsMock.mockResolvedValue([
      {
        data: SERVICE_ERRORS.map(([service, value]: [string, number]) => {
          return point(service, value);
        }),
      } as AggregatedResult,
    ]);
  });

  test("lists its rows A to Z by the attribute until a viewer sorts it", async () => {
    render(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableComponent()}
      />,
    );

    await screen.findByText("checkout");
    expect(firstCells()).toEqual(["auth", "billing", "checkout", "search"]);
    expect(headerCell("attr:0")).toHaveAttribute("aria-sort", "ascending");
    expect(headerCell("col:errors")).toHaveAttribute("aria-sort", "none");
    expect(sortButton("col:errors")).toHaveAttribute(
      "title",
      "Sort: Highest first",
    );
  });

  test("a metric sorts highest first, then lowest first, then back - and the pick is remembered", async () => {
    render(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableComponent()}
      />,
    );
    await screen.findByText("checkout");

    fireEvent.click(sortButton("col:errors"));
    expect(firstCells()).toEqual(["billing", "checkout", "auth", "search"]);
    expect(headerCell("col:errors")).toHaveAttribute("aria-sort", "descending");
    expect(window.localStorage.getItem(PICK_KEY)).toBe("col:errors:desc");

    fireEvent.click(sortButton("col:errors"));
    expect(firstCells()).toEqual(["search", "auth", "checkout", "billing"]);
    expect(window.localStorage.getItem(PICK_KEY)).toBe("col:errors:asc");

    fireEvent.click(sortButton("col:errors"));
    expect(firstCells()).toEqual(["auth", "billing", "checkout", "search"]);
    expect(window.localStorage.getItem(PICK_KEY)).toBeNull();

    // Sorting needs no new read: the table holds every row.
    expect(fetchResultsMock).toHaveBeenCalledTimes(1);
  });

  test("its headers hang the arrow beside their words, before them in a column aligned right", async () => {
    render(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableComponent()}
      />,
    );
    await screen.findByText("checkout");

    // The words keep their own element, free to wrap as a plain header's do.
    expect(sortButton("attr:0").firstElementChild).toHaveTextContent("Service");
    expect(sortButton("attr:0").firstElementChild).not.toHaveClass("truncate");

    /*
     * The arrow and the hint hang from a point of no width in the line:
     * after the last word, or before the first in a metric's column, which
     * is aligned right - so they never draw past the table's edge.
     */
    const serviceAnchor: Element | null = sortButton("attr:0").lastElementChild;
    const errorsAnchor: Element | null =
      sortButton("col:errors").firstElementChild;

    for (const anchor of [serviceAnchor, errorsAnchor]) {
      expect(anchor).toHaveAttribute("aria-hidden", "true");
      expect(anchor).toHaveClass("inline-block", "w-0");
    }

    expect(sortButton("col:errors")).toHaveClass("text-right");
    expect(sortButton("col:errors").lastElementChild).toHaveTextContent(
      "Errors",
    );

    // Neither is read out - aria-sort says the order.
    expect(screen.getByRole("button", { name: "Service" })).toBe(
      sortButton("attr:0"),
    );
    expect(screen.getByRole("button", { name: "Errors" })).toBe(
      sortButton("col:errors"),
    );

    expect(serviceAnchor?.querySelector("svg")).toHaveClass("left-0.5");
    expect(errorsAnchor?.querySelector("svg")).toHaveClass(
      "right-0.5",
      "opacity-0",
    );

    fireEvent.click(sortButton("col:errors"));
    expect(
      sortButton("col:errors").firstElementChild?.querySelector("svg"),
    ).toHaveClass("right-0.5", "text-indigo-500");
  });

  test("sorts before it trims, so Max Rows shows the top rows of the whole window", async () => {
    render(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableComponent({ maxRows: 2 })}
      />,
    );
    await screen.findByText("auth");
    expect(firstCells()).toEqual(["auth", "billing"]);

    fireEvent.click(sortButton("col:errors"));
    expect(firstCells()).toEqual(["billing", "checkout"]);
  });

  test("the widget's saved sort is its order, and a refresh keeps a viewer's pick", async () => {
    window.localStorage.setItem(PICK_KEY, "attr:0:desc");

    const view: ReturnType<typeof render> = render(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableComponent({ sort: "col:errors:desc" })}
      />,
    );
    await screen.findByText("search");

    // The viewer's pick wins over the saved sort.
    expect(firstCells()).toEqual(["search", "checkout", "billing", "auth"]);
    view.unmount();

    window.localStorage.clear();
    render(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableComponent({ sort: "col:errors:desc" })}
      />,
    );
    await screen.findByText("search");
    expect(firstCells()).toEqual(["billing", "checkout", "auth", "search"]);
  });

  test("a saved sort on a column the table no longer has keeps its own order", async () => {
    render(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableComponent({ sort: "col:latency:desc" })}
      />,
    );
    await screen.findByText("checkout");

    expect(firstCells()).toEqual(["auth", "billing", "checkout", "search"]);
  });

  test("in the settings preview, a click sets the widget's own sort, and its columns are reported", async () => {
    const onWidgetSortChange: Mock<(sort: string | null) => void> =
      jest.fn<(sort: string | null) => void>();
    const onWidgetSortColumnsChange: Mock<
      (columns: DashboardWidgetSortColumns) => void
    > = jest.fn<(columns: DashboardWidgetSortColumns) => void>();

    render(
      <DashboardTableComponentElement
        {...baseProps({ onWidgetSortChange, onWidgetSortColumnsChange })}
        component={tableComponent()}
      />,
    );
    await screen.findByText("checkout");

    await waitFor(() => {
      expect(onWidgetSortColumnsChange).toHaveBeenLastCalledWith({
        columns: [
          {
            key: "attr:0",
            title: "Service",
            kind: DashboardWidgetSortKind.Text,
            isTitleUserText: true,
          },
          {
            key: "col:errors",
            title: "Errors",
            kind: DashboardWidgetSortKind.Number,
            isTitleUserText: true,
          },
        ],
        builtInSort: {
          column: "attr:0",
          direction: DashboardWidgetSortDirection.Ascending,
        },
      });
    });

    fireEvent.click(sortButton("col:errors"));
    expect(onWidgetSortChange).toHaveBeenLastCalledWith("col:errors:desc");
    // The preview is the widget as everyone will see it: no pick is kept.
    expect(window.localStorage.length).toBe(0);
  });
});

describe("a metric table over time", () => {
  function timeComponent(): DashboardTableComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: DashboardComponentType.Table,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 8,
      heightInDashboardUnits: 6,
      minWidthInDashboardUnits: 4,
      minHeightInDashboardUnits: 3,
      arguments: {
        columns: [
          {
            id: "rps",
            variable: "a",
            header: "Requests",
            kind: TableColumnKind.Metric,
            metricName: "http.server.requests",
            aggregation: MetricsAggregationType.Sum,
          },
        ],
        maxRows: 25,
      } as DashboardTableComponent["arguments"],
    };
  }

  beforeEach(() => {
    fetchResultsMock.mockResolvedValue([
      {
        data: [
          {
            timestamp: new Date("2026-10-19T10:00:00.000Z"),
            value: 5,
          },
          {
            timestamp: new Date("2026-10-19T10:01:00.000Z"),
            value: 9,
          },
          {
            timestamp: new Date("2026-10-19T10:02:00.000Z"),
            value: 1,
          },
        ] as Array<AggregatedModel>,
      } as AggregatedResult,
    ]);
  });

  function valueCells(): Array<string> {
    return secondCells();
  }

  test("lists oldest first, the time column sorts newest first, a metric highest first", async () => {
    render(
      <DashboardTableComponentElement
        {...baseProps()}
        component={timeComponent()}
      />,
    );

    await waitFor(() => {
      expect(valueCells()).toHaveLength(3);
    });
    expect(valueCells()).toEqual(["5.00", "9.00", "1.00"]);
    expect(headerCell("timestamp")).toHaveAttribute("aria-sort", "ascending");
    expect(sortButton("timestamp")).toHaveAttribute(
      "title",
      "Sorted: Oldest first",
    );

    fireEvent.click(sortButton("timestamp"));
    expect(valueCells()).toEqual(["1.00", "9.00", "5.00"]);
    expect(headerCell("timestamp")).toHaveAttribute("aria-sort", "descending");
    expect(sortButton("timestamp")).toHaveAttribute(
      "title",
      "Sorted: Newest first",
    );

    fireEvent.click(sortButton("col:rps"));
    expect(valueCells()).toEqual(["9.00", "5.00", "1.00"]);
  });
});

describe("a Data Source table", () => {
  const TABLE_RESULT: DataSourceTableResult = {
    columns: [
      {
        key: "service",
        title: "Service",
        type: DataSourceTableColumnType.Text,
      },
      {
        key: "errors",
        title: "Errors",
        type: DataSourceTableColumnType.Number,
      },
    ],
    rows: [
      { service: "checkout", errors: 12 },
      { service: "search", errors: 3 },
      { service: "billing", errors: 41 },
      { service: "Auth", errors: null },
    ],
    truncated: false,
  };

  function dataSourceComponent(
    widgetArguments: JSONObject = {},
  ): DashboardDataSourceTableComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: DashboardComponentType.DataSourceTable,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 8,
      heightInDashboardUnits: 6,
      minWidthInDashboardUnits: 4,
      minHeightInDashboardUnits: 3,
      arguments: {
        query: { dataSourceId: "ds-pg", query: "select 1" },
        ...widgetArguments,
      } as DashboardDataSourceTableComponent["arguments"],
    };
  }

  beforeEach(() => {
    fetchTableMock.mockResolvedValue(TABLE_RESULT);
  });

  test("keeps the query's order until a viewer sorts it; a text column sorts A to Z first", async () => {
    render(
      <DashboardDataSourceTableComponentElement
        {...baseProps()}
        component={dataSourceComponent()}
      />,
    );
    await screen.findByText("checkout");

    expect(firstCells()).toEqual(["checkout", "search", "billing", "Auth"]);
    expect(headerCell("service")).toHaveAttribute("aria-sort", "none");
    expect(headerCell("errors")).toHaveAttribute("aria-sort", "none");

    fireEvent.click(sortButton("service"));
    expect(firstCells()).toEqual(["Auth", "billing", "checkout", "search"]);
    expect(sortButton("service")).toHaveAttribute("title", "Sorted: A to Z");

    fireEvent.click(sortButton("service"));
    expect(firstCells()).toEqual(["search", "checkout", "billing", "Auth"]);

    fireEvent.click(sortButton("service"));
    expect(firstCells()).toEqual(["checkout", "search", "billing", "Auth"]);
  });

  test("a row with no value stays at the bottom both ways", async () => {
    render(
      <DashboardDataSourceTableComponentElement
        {...baseProps()}
        component={dataSourceComponent()}
      />,
    );
    await screen.findByText("checkout");

    fireEvent.click(sortButton("errors"));
    expect(firstCells()).toEqual(["billing", "checkout", "search", "Auth"]);

    fireEvent.click(sortButton("errors"));
    expect(firstCells()).toEqual(["search", "checkout", "billing", "Auth"]);
  });

  test("the widget's saved sort is its order once the query names its columns", async () => {
    render(
      <DashboardDataSourceTableComponentElement
        {...baseProps()}
        component={dataSourceComponent({ sort: "errors:desc" })}
      />,
    );
    await screen.findByText("checkout");

    expect(firstCells()).toEqual(["billing", "checkout", "search", "Auth"]);
    expect(headerCell("errors")).toHaveAttribute("aria-sort", "descending");
  });

  test("a saved sort on a column the query no longer returns keeps the query's order", async () => {
    render(
      <DashboardDataSourceTableComponentElement
        {...baseProps()}
        component={dataSourceComponent({ sort: "latency:desc" })}
      />,
    );
    await screen.findByText("checkout");

    expect(firstCells()).toEqual(["checkout", "search", "billing", "Auth"]);
  });

  test("in the settings preview it reports the query's columns, with no order of its own", async () => {
    const onWidgetSortColumnsChange: Mock<
      (columns: DashboardWidgetSortColumns) => void
    > = jest.fn<(columns: DashboardWidgetSortColumns) => void>();

    render(
      <DashboardDataSourceTableComponentElement
        {...baseProps({ onWidgetSortColumnsChange })}
        component={dataSourceComponent()}
      />,
    );
    await screen.findByText("checkout");

    await waitFor(() => {
      expect(onWidgetSortColumnsChange).toHaveBeenLastCalledWith({
        columns: [
          {
            key: "service",
            title: "Service",
            kind: DashboardWidgetSortKind.Text,
            isTitleUserText: true,
          },
          {
            key: "errors",
            title: "Errors",
            kind: DashboardWidgetSortKind.Number,
            isTitleUserText: true,
          },
        ],
        builtInSort: null,
      });
    });
  });
});

describe("a trace table", () => {
  function traceTableComponent(
    widgetArguments: JSONObject = {},
  ): DashboardTraceTableComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: DashboardComponentType.TraceTable,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 8,
      heightInDashboardUnits: 6,
      minWidthInDashboardUnits: 4,
      minHeightInDashboardUnits: 3,
      arguments: {
        groupByAttribute: "name",
        topLimit: 10,
        ...widgetArguments,
      } as DashboardTraceTableComponent["arguments"],
    };
  }

  function traceRow(name: string, count: number, errors: number): JSONObject {
    return {
      groupValues: { name },
      count,
      errorCount: errors,
      avgDurationMs: 10,
      p50DurationMs: 9,
      p90DurationMs: 20,
      p95DurationMs: 25,
      p99DurationMs: 40,
      minDurationMs: 1,
      maxDurationMs: 80,
    };
  }

  function lastTableSort(): unknown {
    const calls: Array<[{ url: unknown; data: JSONObject }]> =
      apiPostMock.mock.calls;
    return calls[calls.length - 1]![0].data["tableSort"];
  }

  beforeEach(() => {
    apiPostMock.mockResolvedValue({
      data: {
        data: [traceRow("GET /cart", 120, 4), traceRow("POST /pay", 30, 9)],
      },
    });
  });

  test("asks for the busiest groups first, as it always ranked them", async () => {
    render(
      <DashboardTraceTableComponentElement
        {...baseProps()}
        component={traceTableComponent()}
      />,
    );
    await screen.findByText("GET /cart");

    expect(lastTableSort()).toEqual({ column: "count", direction: "desc" });
    expect(headerCell("count")).toHaveAttribute("aria-sort", "descending");
    expect(secondCells()).toEqual(["GET /cart", "POST /pay"]);
  });

  test("a metric header asks the server to rank by it, highest first, then lowest, then back", async () => {
    render(
      <DashboardTraceTableComponentElement
        {...baseProps()}
        component={traceTableComponent()}
      />,
    );
    await screen.findByText("GET /cart");

    fireEvent.click(sortButton("errorCount"));
    await waitFor(() => {
      expect(lastTableSort()).toEqual({
        column: "errorCount",
        direction: "desc",
      });
    });
    expect(window.localStorage.getItem(PICK_KEY)).toBe("errorCount:desc");

    fireEvent.click(sortButton("errorCount"));
    await waitFor(() => {
      expect(lastTableSort()).toEqual({
        column: "errorCount",
        direction: "asc",
      });
    });

    fireEvent.click(sortButton("errorCount"));
    await waitFor(() => {
      expect(lastTableSort()).toEqual({ column: "count", direction: "desc" });
    });
    expect(window.localStorage.getItem(PICK_KEY)).toBeNull();
  });

  test("the group column sorts by the dimension, under the dimension's name", async () => {
    render(
      <DashboardTraceTableComponentElement
        {...baseProps()}
        component={traceTableComponent()}
      />,
    );
    await screen.findByText("GET /cart");

    expect(sortButton("group")).toHaveTextContent("Span Name");

    fireEvent.click(sortButton("group"));
    await waitFor(() => {
      expect(lastTableSort()).toEqual({ column: "group", direction: "asc" });
    });
  });

  test("a resource dimension's group column does not sort, and a saved sort on it is not sent", async () => {
    render(
      <DashboardTraceTableComponentElement
        {...baseProps()}
        component={traceTableComponent({
          groupByAttribute: "hostId",
          sort: "group:asc",
        })}
      />,
    );
    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledTimes(1);
    });

    expect(lastTableSort()).toEqual({ column: "count", direction: "desc" });
    expect(
      screen.queryByTestId(getDashboardWidgetSortHeaderTestId("group")),
    ).not.toBeInTheDocument();
  });

  test("the widget's saved sort goes with its first read", async () => {
    render(
      <DashboardTraceTableComponentElement
        {...baseProps()}
        component={traceTableComponent({ sort: "p99:desc" })}
      />,
    );
    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledTimes(1);
    });

    expect(lastTableSort()).toEqual({ column: "p99", direction: "desc" });
  });
});

describe("a security events list", () => {
  function securityComponent(
    widgetArguments: JSONObject = {},
  ): DashboardSecurityEventsListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: DashboardComponentType.SecurityEventsList,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 8,
      heightInDashboardUnits: 6,
      minWidthInDashboardUnits: 4,
      minHeightInDashboardUnits: 3,
      arguments: {
        title: "Security events",
        ...widgetArguments,
      } as DashboardSecurityEventsListComponent["arguments"],
    };
  }

  function lastSort(): JSONObject {
    const calls: Array<
      [{ query: JSONObject; sort: JSONObject; limit: number }]
    > = analyticsGetListMock.mock.calls;
    return calls[calls.length - 1]![0].sort;
  }

  beforeEach(() => {
    analyticsGetListMock.mockResolvedValue({
      data: [
        {
          time: "2026-10-19T10:30:00.000Z",
          severityName: "High",
          className: "Authentication",
          message: "Failed login for root",
          principalHost: "bastion-1",
        },
      ],
      count: 1,
    });
  });

  test("is a table, newest first, whose message column does not sort", async () => {
    render(
      <DashboardSecurityEventsListComponentElement
        {...baseProps()}
        component={securityComponent()}
      />,
    );
    await screen.findByText("Failed login for root");

    expect(lastSort()).toEqual({ time: SortOrder.Descending });
    expect(headerCell("time")).toHaveAttribute("aria-sort", "descending");
    expect(
      screen.getByRole("columnheader", { name: "Message" }),
    ).not.toHaveAttribute("aria-sort");
    expect(
      screen.queryByTestId(getDashboardWidgetSortHeaderTestId("message")),
    ).not.toBeInTheDocument();
  });

  test("Severity sorts the most severe first, then the least, newest first among equals", async () => {
    render(
      <DashboardSecurityEventsListComponentElement
        {...baseProps()}
        component={securityComponent()}
      />,
    );
    await screen.findByText("Failed login for root");

    fireEvent.click(sortButton("severity"));
    await waitFor(() => {
      expect(lastSort()).toEqual({
        severityId: SortOrder.Descending,
        time: SortOrder.Descending,
      });
    });

    fireEvent.click(sortButton("severity"));
    await waitFor(() => {
      expect(lastSort()).toEqual({
        severityId: SortOrder.Ascending,
        time: SortOrder.Descending,
      });
    });
  });

  test("draws one line per event: the time and the severity as wide as their cells", async () => {
    render(
      <DashboardSecurityEventsListComponentElement
        {...baseProps()}
        component={securityComponent()}
      />,
    );
    await screen.findByText("Failed login for root");

    // A time and a severity: the least width, so their cells decide it.
    for (const columnKey of ["time", "severity"]) {
      expect(headerCell(columnKey)).toHaveStyle({ width: "1%" });
      expect(headerCell(columnKey)).toHaveClass("whitespace-nowrap");
    }

    // The class, the message and the host share the rest.
    expect(headerCell("class")).toHaveStyle({ width: "18%" });
    expect(headerCell("host")).toHaveStyle({ width: "14%" });
    expect(screen.getByRole("columnheader", { name: "Message" })).toHaveStyle({
      width: "34%",
    });

    const cells: Array<HTMLElement> = Array.from(
      document.querySelectorAll("tbody tr td"),
    ) as Array<HTMLElement>;

    // The date and the time of day stay on one line, as one text.
    expect(cells[0]).toHaveClass("whitespace-nowrap");
    expect(cells[0]!.querySelectorAll("span")).toHaveLength(0);
    expect(cells[0]!.textContent).toMatch(TIME_OF_DAY_WITH_SECONDS);
    expect(cells[1]).toHaveClass("whitespace-nowrap");

    // The rest are cut short with an ellipsis, whole on hover.
    expect(cells[2]).toHaveClass("max-w-0", "truncate");
    expect(cells[2]).toHaveAttribute("title", "Authentication");
    expect(cells[3]).toHaveClass("max-w-0", "truncate");
    expect(cells[3]).toHaveAttribute("title", "Failed login for root");
    expect(cells[4]).toHaveClass("max-w-0", "truncate");
    expect(cells[4]).toHaveAttribute("title", "bastion-1");
  });

  test("an event without a class, a message or a host says so with a dash", async () => {
    analyticsGetListMock.mockResolvedValue({
      data: [
        {
          time: "2026-10-19T10:30:00.000Z",
          severityName: "Low",
        },
      ],
      count: 1,
    });

    render(
      <DashboardSecurityEventsListComponentElement
        {...baseProps()}
        component={securityComponent()}
      />,
    );
    await screen.findByText("Low");

    const cells: Array<string> = Array.from(
      document.querySelectorAll("tbody tr td"),
    ).map((cell: Element): string => {
      return (cell.textContent || "").trim();
    });

    expect(cells.slice(2)).toEqual(["—", "—", "—"]);
  });

  test("Host sorts A to Z first", async () => {
    render(
      <DashboardSecurityEventsListComponentElement
        {...baseProps()}
        component={securityComponent()}
      />,
    );
    await screen.findByText("Failed login for root");

    fireEvent.click(sortButton("host"));
    await waitFor(() => {
      expect(lastSort()).toEqual({
        principalHost: SortOrder.Ascending,
        time: SortOrder.Descending,
      });
    });
  });
});
