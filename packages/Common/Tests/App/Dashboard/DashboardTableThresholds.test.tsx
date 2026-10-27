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
import React, { ReactElement, useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import DashboardTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTableComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import { getDashboardWidgetSortHeaderTestId } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetSortCopy";
import TableColumnsEditor from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/TableColumnsEditor";
import {
  WidgetCatalogCategory,
  WidgetCatalogItem,
  searchWidgetCatalog,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/WidgetCatalog";
import ArgumentsForm from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm";
import DashboardTableComponent, {
  TableColumn,
  TableColumnKind,
  TableThresholdDirection,
  TableThresholdLevel,
  TableThresholdStyle,
} from "../../../Types/Dashboard/DashboardComponents/DashboardTableComponent";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * Threshold colors on a dashboard's metric table (issue #5231), through the
 * real widget and its real settings:
 *
 *   - each value column may have a warning and a critical threshold, higher
 *     or lower is worse; a value that reaches one is amber or red, with a
 *     triangle or a circle before it (critical also bold), and its cell says
 *     which threshold it reached to the pointer and to a screen reader;
 *   - a usage metric sent as a fraction of 1 shows - and is compared - as a
 *     percent, rounded as the cell shows it;
 *   - the whole table colors the number (the default) or the whole cell;
 *   - in the settings, each shown column's card turns thresholds on with a
 *     checkbox (80 and 90 for a percent column), and once one is on, the
 *     table's Threshold colors are asked under the columns.
 *
 * The rules alone are tested in Tests/Utils/Dashboard/TableThresholds.test.ts.
 */

type FetchResults = (data: {
  metricViewData: {
    queryConfigs: Array<{
      metricQueryData: { filterData: { metricName?: unknown } };
    }>;
    formulaConfigs: Array<unknown>;
  };
}) => Promise<Array<AggregatedResult>>;

const fetchResultsMock: Mock<FetchResults> = jest.fn<FetchResults>();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (data: Parameters<FetchResults>[0]) => {
          return fetchResultsMock(data);
        },
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

const DASHBOARD_ID: string = "d0000000-0000-4000-8000-000000005231";
const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000005231",
);

const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-10-27T09:00:00.000Z"),
    new Date("2026-10-27T10:00:00.000Z"),
  ),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

function metricType(name: string, unit: string): MetricType {
  const type: MetricType = new MetricType();
  type.name = name;
  type.unit = unit;
  return type;
}

const METRIC_TYPES: Array<MetricType> = [
  metricType("system.cpu.utilization", "1"),
  metricType("system.memory.utilization", "1"),
  metricType("disk.free", "%"),
  metricType("http.requests", "1"),
  metricType("process.count", "1"),
];

const USAGE: { warning: number; critical: number } = {
  warning: 80,
  critical: 90,
};

// One host's reading of each metric; null when it sent none.
interface HostReading {
  host: string;
  cpu: number | null;
  free: number;
  memory: number;
  requests: number;
  errorRate: number;
}

const HOSTS: Array<HostReading> = [
  {
    host: "web-1",
    cpu: 0.42,
    free: 55,
    memory: 0.99,
    requests: 10,
    errorRate: 0.5,
  },
  {
    host: "web-2",
    cpu: 0.85,
    free: 18,
    memory: 0.5,
    requests: 20,
    errorRate: 2,
  },
  {
    host: "web-3",
    cpu: 0.93,
    free: 7,
    memory: 0.5,
    requests: 30,
    errorRate: 7.5,
  },
  { host: "db-1", cpu: 0.8, free: 20, memory: 0.5, requests: 40, errorRate: 1 },
  { host: "db-2", cpu: 0.9, free: 10, memory: 0.5, requests: 50, errorRate: 5 },
  {
    host: "cache-1",
    cpu: null,
    free: 30,
    memory: 0.5,
    requests: 60,
    errorRate: 0,
  },
];

const READ_BY_METRIC: Record<string, (reading: HostReading) => number | null> =
  {
    "system.cpu.utilization": (reading: HostReading) => {
      return reading.cpu;
    },
    "disk.free": (reading: HostReading) => {
      return reading.free;
    },
    "system.memory.utilization": (reading: HostReading) => {
      return reading.memory;
    },
    "http.requests": (reading: HostReading) => {
      return reading.requests;
    },
  };

function point(host: string, value: number): AggregatedModel {
  return {
    timestamp: new Date("2026-10-27T09:55:00.000Z"),
    value,
    attributes: { "host.name": host },
  } as unknown as AggregatedModel;
}

/*
 * Answers the way MetricUtil.fetchResults does: one result per query, in
 * the order asked, then one per formula.
 */
function answerFromHosts(hosts: Array<HostReading>): void {
  fetchResultsMock.mockImplementation(
    async (data: Parameters<FetchResults>[0]) => {
      const results: Array<AggregatedResult> =
        data.metricViewData.queryConfigs.map(
          (config: {
            metricQueryData: { filterData: { metricName?: unknown } };
          }): AggregatedResult => {
            const read: ((reading: HostReading) => number | null) | undefined =
              READ_BY_METRIC[
                String(config.metricQueryData.filterData.metricName)
              ];
            const data: Array<AggregatedModel> = [];

            for (const reading of hosts) {
              const value: number | null = read ? read(reading) : null;

              if (value !== null) {
                data.push(point(reading.host, value));
              }
            }

            return { data } as AggregatedResult;
          },
        );

      for (
        let index: number = 0;
        index < data.metricViewData.formulaConfigs.length;
        index++
      ) {
        results.push({
          data: hosts.map((reading: HostReading): AggregatedModel => {
            return point(reading.host, reading.errorRate);
          }),
        } as AggregatedResult);
      }

      return results;
    },
  );
}

function hostColumns(): Array<TableColumn> {
  return [
    {
      id: "cpu",
      variable: "a",
      header: "CPU",
      kind: TableColumnKind.Metric,
      metricName: "system.cpu.utilization",
      aggregation: MetricsAggregationType.Avg,
      thresholds: {
        ...USAGE,
        direction: TableThresholdDirection.HigherIsWorse,
      },
    },
    {
      id: "free",
      variable: "b",
      header: "Free disk",
      kind: TableColumnKind.Metric,
      metricName: "disk.free",
      aggregation: MetricsAggregationType.Avg,
      thresholds: {
        warning: 20,
        critical: 10,
        direction: TableThresholdDirection.LowerIsWorse,
      },
    },
    {
      id: "memory",
      variable: "c",
      header: "Memory",
      kind: TableColumnKind.Metric,
      metricName: "system.memory.utilization",
      aggregation: MetricsAggregationType.Avg,
    },
    {
      id: "requests",
      variable: "d",
      header: "Requests",
      kind: TableColumnKind.Metric,
      metricName: "http.requests",
      aggregation: MetricsAggregationType.Sum,
      showAsColumn: false,
      thresholds: { warning: 1, critical: 2 },
    },
    {
      id: "errors",
      variable: "e",
      header: "Error rate",
      kind: TableColumnKind.Formula,
      formula: "(d / 100) * 100",
      unit: "%",
      thresholds: { warning: 1, critical: 5 },
    },
  ];
}

function tableComponent(
  widgetArguments: Partial<DashboardTableComponent["arguments"]> = {},
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
      columns: hostColumns(),
      groupByAttributes: [{ key: "host.name", header: "Host" }],
      maxRows: 25,
      ...widgetArguments,
    },
  };
}

function baseProps(): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "table-thresholds",
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
    metricTypes: METRIC_TYPES,
    refreshTick: 0,
    dashboardId: DASHBOARD_ID,
  };
}

async function renderTable(
  widgetArguments: Partial<DashboardTableComponent["arguments"]> = {},
): Promise<void> {
  render(
    <DashboardTableComponentElement
      {...baseProps()}
      component={tableComponent(widgetArguments)}
    />,
  );
  await screen.findByText("web-1");
}

// The table's column headers, as drawn.
function headers(): Array<string> {
  return Array.from(document.querySelectorAll("thead th")).map(
    (cell: Element): string => {
      return (cell.textContent || "").trim();
    },
  );
}

// A row's cell under a header, found by the row's first cell.
function cell(rowName: string, header: string): HTMLElement {
  const column: number = headers().indexOf(header);
  expect([header, column >= 0]).toEqual([header, true]);

  const row: Element | undefined = Array.from(
    document.querySelectorAll("tbody tr"),
  ).find((candidate: Element): boolean => {
    return (
      (candidate.querySelector("td")?.textContent || "").trim() === rowName
    );
  });
  expect([rowName, Boolean(row)]).toEqual([rowName, true]);

  return row!.querySelectorAll("td")[column] as HTMLElement;
}

function levelOf(element: HTMLElement): string | null {
  return element.getAttribute("data-threshold-level");
}

// What a cell says, level and all: [text, level, title, the icon's name].
function described(
  rowName: string,
  header: string,
): [string, string | null, string | null, string | null] {
  const target: HTMLElement = cell(rowName, header);
  const icon: HTMLElement | null = target.querySelector('[role="img"]');

  return [
    (target.textContent || "").trim(),
    levelOf(target),
    target.getAttribute("title"),
    icon ? icon.getAttribute("aria-label") : null,
  ];
}

beforeEach(() => {
  fetchResultsMock.mockReset();
  answerFromHosts(HOSTS);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("a metric table colored by its columns' thresholds", () => {
  test("a hidden column is still read for formulas but never drawn, thresholds or not", async () => {
    await renderTable();

    expect(headers()).toEqual([
      "Host",
      "CPU",
      "Free disk",
      "Memory",
      "Error rate",
    ]);
    expect(screen.queryByText("Requests")).not.toBeInTheDocument();
  });

  test("a usage metric sent as a fraction shows as a percent and is colored in that scale", async () => {
    await renderTable();

    expect(described("web-1", "CPU")).toEqual(["42.00%", null, null, null]);
    expect(described("web-2", "CPU")).toEqual([
      "85.00%",
      TableThresholdLevel.Warning,
      "Warning: 80% and above",
      "Warning: 80% and above",
    ]);
    expect(described("web-3", "CPU")).toEqual([
      "93.00%",
      TableThresholdLevel.Critical,
      "Critical: 90% and above",
      "Critical: 90% and above",
    ]);
  });

  test("a threshold is reached at its value: 80% is a warning and 90% critical", async () => {
    await renderTable();

    expect(levelOf(cell("db-1", "CPU"))).toBe(TableThresholdLevel.Warning);
    expect(cell("db-1", "CPU")).toHaveTextContent("80.00%");
    expect(levelOf(cell("db-2", "CPU"))).toBe(TableThresholdLevel.Critical);
    expect(cell("db-2", "CPU")).toHaveTextContent("90.00%");
  });

  test("a host with no reading shows a dash and is never colored", async () => {
    await renderTable();

    expect(described("cache-1", "CPU")).toEqual(["—", null, null, null]);
    expect(cell("cache-1", "CPU")).toHaveClass("text-gray-900");
  });

  test("lower is worse: free disk reaches its thresholds at or below them", async () => {
    await renderTable();

    expect(described("web-1", "Free disk")).toEqual([
      "55.00%",
      null,
      null,
      null,
    ]);
    expect(described("web-2", "Free disk")).toEqual([
      "18.00%",
      TableThresholdLevel.Warning,
      "Warning: 20% and below",
      "Warning: 20% and below",
    ]);
    expect(levelOf(cell("db-1", "Free disk"))).toBe(
      TableThresholdLevel.Warning,
    );
    expect(described("web-3", "Free disk")).toEqual([
      "7.00%",
      TableThresholdLevel.Critical,
      "Critical: 10% and below",
      "Critical: 10% and below",
    ]);
    expect(levelOf(cell("db-2", "Free disk"))).toBe(
      TableThresholdLevel.Critical,
    );
  });

  test("a column without thresholds is never colored, even at 99%", async () => {
    await renderTable();

    expect(described("web-1", "Memory")).toEqual(["99.00%", null, null, null]);
    for (const host of HOSTS) {
      expect(levelOf(cell(host.host, "Memory"))).toBeNull();
    }
  });

  test("a formula column is colored by its own thresholds, in the unit typed for it", async () => {
    await renderTable();

    expect(described("web-1", "Error rate")).toEqual([
      "0.50%",
      null,
      null,
      null,
    ]);
    expect(levelOf(cell("db-1", "Error rate"))).toBe(
      TableThresholdLevel.Warning,
    );
    expect(levelOf(cell("web-2", "Error rate"))).toBe(
      TableThresholdLevel.Warning,
    );
    expect(levelOf(cell("db-2", "Error rate"))).toBe(
      TableThresholdLevel.Critical,
    );
    expect(described("web-3", "Error rate")).toEqual([
      "7.50%",
      TableThresholdLevel.Critical,
      "Critical: 5% and above",
      "Critical: 5% and above",
    ]);
  });

  test("a level is never told by color alone: a shape and a name, and critical in bold", async () => {
    await renderTable();

    const warning: HTMLElement = cell("web-2", "CPU");
    const critical: HTMLElement = cell("web-3", "CPU");
    const normal: HTMLElement = cell("web-1", "CPU");

    expect(warning).toHaveClass("text-amber-700", "font-semibold");
    expect(warning).not.toHaveClass("font-bold");
    expect(critical).toHaveClass("text-red-700", "font-bold");
    expect(normal).toHaveClass("text-gray-900", "font-semibold");

    // A triangle for a warning, a circle for critical: two shapes.
    const warningIcon: string =
      warning.querySelector("svg path")?.getAttribute("d") || "";
    const criticalIcon: string =
      critical.querySelector("svg path")?.getAttribute("d") || "";
    expect(warningIcon).not.toBe("");
    expect(criticalIcon).not.toBe("");
    expect(warningIcon).not.toBe(criticalIcon);

    // A screen reader hears the level and its threshold with the value.
    expect(
      within(critical).getByRole("img", { name: "Critical: 90% and above" }),
    ).toBeInTheDocument();
    expect(normal.querySelector("svg")).toBeNull();
    expect(normal).not.toHaveAttribute("title");
  });

  test("the shape comes before the number, so a column's numbers still line up at their end", async () => {
    await renderTable();

    const critical: HTMLElement = cell("web-3", "CPU");
    const line: Element | null = critical.firstElementChild;

    expect(critical).toHaveClass("text-right", "tabular-nums");
    expect(line?.firstElementChild).toHaveAttribute("role", "img");
    expect(line?.lastElementChild).toHaveTextContent("93.00%");
  });

  test("Colored background fills the whole cell, in the level's color", async () => {
    await renderTable({ thresholdStyle: TableThresholdStyle.Background });

    expect(cell("web-2", "CPU")).toHaveClass(
      "bg-amber-100",
      "text-amber-900",
      "font-semibold",
    );
    expect(cell("web-3", "CPU")).toHaveClass(
      "bg-red-100",
      "text-red-900",
      "font-bold",
    );
    expect(cell("web-1", "CPU").className).not.toMatch(/\bbg-/);
    // The shape and the words stay.
    expect(
      within(cell("web-3", "CPU")).getByRole("img", {
        name: "Critical: 90% and above",
      }),
    ).toBeInTheDocument();
  });

  test("a style the table does not know colors the number", async () => {
    await renderTable({
      thresholdStyle: "Rainbow" as unknown as TableThresholdStyle,
    });

    expect(cell("web-3", "CPU")).toHaveClass("text-red-700");
    expect(cell("web-3", "CPU").className).not.toMatch(/\bbg-/);
  });

  test("thresholds written as text by the API or Terraform still color", async () => {
    const columns: Array<TableColumn> = hostColumns();
    columns[0]!.thresholds = {
      warning: "80",
      critical: " 90 ",
    } as unknown as TableColumn["thresholds"];

    await renderTable({ columns });

    expect(levelOf(cell("web-2", "CPU"))).toBe(TableThresholdLevel.Warning);
    expect(levelOf(cell("web-3", "CPU"))).toBe(TableThresholdLevel.Critical);
  });

  test("thresholds that are not numbers color nothing", async () => {
    const columns: Array<TableColumn> = hostColumns();
    columns[0]!.thresholds = {
      warning: "high",
      critical: null,
    } as unknown as TableColumn["thresholds"];

    await renderTable({ columns });

    for (const host of HOSTS) {
      expect(levelOf(cell(host.host, "CPU"))).toBeNull();
    }
  });

  test("the number on screen is what is compared: 79.6% at no decimals reads 80% and is a warning", async () => {
    answerFromHosts([
      { ...HOSTS[0]!, host: "edge-1", cpu: 0.796 },
      { ...HOSTS[0]!, host: "edge-2", cpu: 0.794 },
    ]);
    const columns: Array<TableColumn> = hostColumns();
    columns[0]!.decimals = 0;

    render(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableComponent({ columns })}
      />,
    );
    await screen.findByText("edge-1");

    expect(described("edge-1", "CPU")).toEqual([
      "80%",
      TableThresholdLevel.Warning,
      "Warning: 80% and above",
      "Warning: 80% and above",
    ]);
    expect(described("edge-2", "CPU")).toEqual(["79%", null, null, null]);
  });

  test("a fraction a hair under its threshold after x100 still reaches it", async () => {
    answerFromHosts([{ ...HOSTS[0]!, host: "edge-1", cpu: 0.29 }]);
    const columns: Array<TableColumn> = hostColumns();
    columns[0]!.thresholds = { warning: 29 };

    render(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableComponent({ columns })}
      />,
    );
    await screen.findByText("edge-1");

    // 0.29 * 100 is 28.999999999999996 in floating point.
    expect(described("edge-1", "CPU")).toEqual([
      "29.00%",
      TableThresholdLevel.Warning,
      "Warning: 29% and above",
      "Warning: 29% and above",
    ]);
  });

  test("sorting by a colored column keeps each value's color", async () => {
    await renderTable();

    fireEvent.click(
      screen.getByTestId(getDashboardWidgetSortHeaderTestId("col:cpu")),
    );

    const firstRow: Element = document.querySelectorAll("tbody tr")[0]!;
    expect(firstRow.querySelector("td")).toHaveTextContent("web-3");
    expect(levelOf(cell("web-3", "CPU"))).toBe(TableThresholdLevel.Critical);
    expect(levelOf(cell("web-1", "CPU"))).toBeNull();
  });

  test("a metric whose unit is 1 shows a plain number, never a trailing 1", async () => {
    const columns: Array<TableColumn> = [
      {
        id: "processes",
        variable: "a",
        header: "Processes",
        kind: TableColumnKind.Metric,
        metricName: "process.count",
        aggregation: MetricsAggregationType.Avg,
      },
    ];
    READ_BY_METRIC["process.count"] = (reading: HostReading) => {
      return reading.requests;
    };

    try {
      await renderTable({ columns });

      expect(cell("web-1", "Processes")).toHaveTextContent(/^10\.00$/);
    } finally {
      delete READ_BY_METRIC["process.count"];
    }
  });
});

describe("a metric table over time, colored by its thresholds", () => {
  test("each time bucket's value is colored by the column's thresholds", async () => {
    fetchResultsMock.mockReset();
    fetchResultsMock.mockResolvedValue([
      {
        data: [
          { timestamp: new Date("2026-10-27T09:00:00.000Z"), value: 0.5 },
          { timestamp: new Date("2026-10-27T09:01:00.000Z"), value: 0.82 },
          { timestamp: new Date("2026-10-27T09:02:00.000Z"), value: 0.97 },
        ] as Array<AggregatedModel>,
      } as AggregatedResult,
    ]);

    render(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableComponent({
          groupByAttributes: [],
          columns: [hostColumns()[0]!],
        })}
      />,
    );

    await waitFor(() => {
      expect(document.querySelectorAll("tbody tr")).toHaveLength(3);
    });

    const values: Array<[string, string | null]> = Array.from(
      document.querySelectorAll("tbody tr"),
    ).map((row: Element): [string, string | null] => {
      const valueCell: HTMLElement = row.querySelectorAll(
        "td",
      )[1] as HTMLElement;
      return [(valueCell.textContent || "").trim(), levelOf(valueCell)];
    });

    expect(values).toEqual([
      ["50.00%", null],
      ["82.00%", TableThresholdLevel.Warning],
      ["97.00%", TableThresholdLevel.Critical],
    ]);
  });
});

describe("a metric table saved in the old shape", () => {
  test("a fraction shows as a percent, and nothing is colored: it has no thresholds", async () => {
    fetchResultsMock.mockReset();
    answerFromHosts(HOSTS);

    render(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableComponent({
          columns: undefined,
          groupByAttributes: undefined,
          metricQueryConfig: {
            metricAliasData: {
              metricVariable: "a",
              title: undefined,
              description: undefined,
              legend: "CPU",
              legendUnit: undefined,
            },
            metricQueryData: {
              filterData: {
                metricName: "system.cpu.utilization",
                aggegationType: MetricsAggregationType.Avg,
              },
              groupBy: undefined,
              groupByAttributeKeys: ["host.name"],
            },
          },
        } as unknown as Partial<DashboardTableComponent["arguments"]>)}
      />,
    );
    await screen.findByText("web-3");

    expect(described("web-3", "CPU")).toEqual(["93.00%", null, null, null]);
  });
});

// A column card's settings, kept by the test the way ArgumentsForm keeps them.
function EditorHarness(props: {
  initial: Array<TableColumn>;
  thresholdStyle?: TableThresholdStyle | undefined;
  onChange: (columns: Array<TableColumn>) => void;
}): ReactElement {
  const [columns, setColumns] = useState<Array<TableColumn>>(props.initial);

  return (
    <TableColumnsEditor
      columns={columns}
      metricTypes={METRIC_TYPES}
      thresholdStyle={props.thresholdStyle}
      onChange={(next: Array<TableColumn>): void => {
        setColumns(next);
        props.onChange(next);
      }}
    />
  );
}

type ColumnsChange = Mock<(columns: Array<TableColumn>) => void>;

function renderEditor(
  initial: Array<TableColumn>,
  thresholdStyle?: TableThresholdStyle,
): ColumnsChange {
  const onChange: ColumnsChange =
    jest.fn<(columns: Array<TableColumn>) => void>();
  render(
    <EditorHarness
      initial={initial}
      thresholdStyle={thresholdStyle}
      onChange={onChange}
    />,
  );
  return onChange;
}

function lastColumns(onChange: ColumnsChange): Array<TableColumn> {
  const calls: Array<[Array<TableColumn>]> = onChange.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0];
}

function plainColumn(overrides: Partial<TableColumn>): TableColumn {
  return {
    id: "cpu",
    variable: "a",
    header: "CPU",
    kind: TableColumnKind.Metric,
    metricName: "system.cpu.utilization",
    aggregation: MetricsAggregationType.Avg,
    showAsColumn: true,
    ...overrides,
  };
}

function legendRules(columnId: string): Array<[string | null, string]> {
  const legend: HTMLElement | null = screen.queryByTestId(
    `table-column-thresholds-legend-${columnId}`,
  );

  if (!legend) {
    return [];
  }

  return Array.from(legend.children).map(
    (entry: Element): [string | null, string] => {
      return [
        entry.getAttribute("data-threshold-level"),
        (entry.textContent || "").trim(),
      ];
    },
  );
}

describe("a column's thresholds in the table's settings", () => {
  test("every shown column offers them, off until ticked", () => {
    renderEditor([plainColumn({})]);

    const toggle: HTMLElement = screen.getByTestId(
      "table-column-thresholds-toggle-cpu",
    );
    expect(toggle).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Color by thresholds" })).toBe(
      toggle,
    );
    expect(
      screen.queryByTestId("table-column-thresholds-warning-cpu"),
    ).not.toBeInTheDocument();
  });

  test("a column hidden from the table has no thresholds to set", () => {
    renderEditor([plainColumn({ showAsColumn: false })]);

    expect(
      screen.queryByTestId("table-column-thresholds-cpu"),
    ).not.toBeInTheDocument();
  });

  test("a percent column starts at 80 and 90, higher is worse, and says so", () => {
    const onChange: ColumnsChange = renderEditor([plainColumn({})]);

    fireEvent.click(screen.getByTestId("table-column-thresholds-toggle-cpu"));

    expect(lastColumns(onChange)[0]!.thresholds).toEqual({
      warning: 80,
      critical: 90,
      direction: TableThresholdDirection.HigherIsWorse,
    });
    expect(
      screen.getByTestId("table-column-thresholds-warning-cpu"),
    ).toHaveValue(80);
    expect(
      screen.getByTestId("table-column-thresholds-critical-cpu"),
    ).toHaveValue(90);
    expect(legendRules("cpu")).toEqual([
      [TableThresholdLevel.Warning, "Warning: 80% and above"],
      [TableThresholdLevel.Critical, "Critical: 90% and above"],
    ]);
  });

  test("each threshold's field is labelled, and its unit describes it", () => {
    renderEditor([plainColumn({ thresholds: { ...USAGE } })]);

    const warning: HTMLElement = screen.getByLabelText("Warning at");
    expect(warning).toBe(
      screen.getByTestId("table-column-thresholds-warning-cpu"),
    );
    expect(screen.getByLabelText("Critical at")).toBe(
      screen.getByTestId("table-column-thresholds-critical-cpu"),
    );

    const unit: HTMLElement = screen.getByTestId(
      "table-column-thresholds-warning-cpu-unit",
    );
    expect(unit).toHaveTextContent("%");
    expect(warning.getAttribute("aria-describedby") || "").toContain(unit.id);
  });

  test("a column in another unit starts with no numbers, and says what to fill in", () => {
    const onChange: ColumnsChange = renderEditor([
      plainColumn({
        id: "requests",
        header: "Requests",
        metricName: "http.requests",
        unit: "req/s",
      }),
    ]);

    fireEvent.click(
      screen.getByTestId("table-column-thresholds-toggle-requests"),
    );

    expect(lastColumns(onChange)[0]!.thresholds).toEqual({
      direction: TableThresholdDirection.HigherIsWorse,
    });
    expect(
      screen.getByTestId("table-column-thresholds-warning-requests"),
    ).toHaveValue(null);
    expect(
      screen.getByTestId("table-column-thresholds-empty-requests"),
    ).toHaveTextContent(
      "Set a warning or a critical value to color this column.",
    );
    expect(
      screen.getByTestId("table-column-thresholds-warning-requests-unit"),
    ).toHaveTextContent("req/s");
  });

  test("typing a threshold writes it, and the legend follows", () => {
    const onChange: ColumnsChange = renderEditor([
      plainColumn({ thresholds: { ...USAGE } }),
    ]);

    fireEvent.change(
      screen.getByTestId("table-column-thresholds-warning-cpu"),
      {
        target: { value: "75.5" },
      },
    );

    expect(lastColumns(onChange)[0]!.thresholds).toEqual({
      warning: 75.5,
      critical: 90,
      direction: TableThresholdDirection.HigherIsWorse,
    });
    expect(legendRules("cpu")[0]).toEqual([
      TableThresholdLevel.Warning,
      "Warning: 75.5% and above",
    ]);
  });

  test("clearing a threshold takes it off the column, and the other still colors", () => {
    const onChange: ColumnsChange = renderEditor([
      plainColumn({ thresholds: { ...USAGE } }),
    ]);

    fireEvent.change(
      screen.getByTestId("table-column-thresholds-warning-cpu"),
      {
        target: { value: "" },
      },
    );

    const thresholds: JSONObject = lastColumns(onChange)[0]!
      .thresholds as unknown as JSONObject;
    expect(thresholds).toEqual({
      critical: 90,
      direction: TableThresholdDirection.HigherIsWorse,
    });
    expect(Object.keys(thresholds)).not.toContain("warning");
    expect(legendRules("cpu")).toEqual([
      [TableThresholdLevel.Critical, "Critical: 90% and above"],
    ]);
  });

  test("lower is worse is one pick away, and the legend says and below", () => {
    const onChange: ColumnsChange = renderEditor([
      plainColumn({
        id: "free",
        header: "Free disk",
        metricName: "disk.free",
        thresholds: { warning: 20, critical: 10 },
      }),
    ]);

    const direction: HTMLElement = within(
      screen.getByTestId("table-column-thresholds-free"),
    ).getByRole("combobox");
    fireEvent.keyDown(direction, { key: "ArrowDown" });
    const option: HTMLElement = screen.getByRole("option", {
      name: "Lower is worse",
    });
    fireEvent.mouseDown(option);
    fireEvent.click(option);

    expect(lastColumns(onChange)[0]!.thresholds).toEqual({
      warning: 20,
      critical: 10,
      direction: TableThresholdDirection.LowerIsWorse,
    });
    expect(legendRules("free")).toEqual([
      [TableThresholdLevel.Warning, "Warning: 20% and below"],
      [TableThresholdLevel.Critical, "Critical: 10% and below"],
    ]);
    expect(
      screen.queryByTestId("table-column-thresholds-reversed-free"),
    ).not.toBeInTheDocument();
  });

  test("critical on the wrong side of warning says how to put it right", () => {
    renderEditor([
      plainColumn({ thresholds: { warning: 90, critical: 80 } }),
      plainColumn({
        id: "free",
        variable: "b",
        header: "Free disk",
        metricName: "disk.free",
        thresholds: {
          warning: 10,
          critical: 20,
          direction: TableThresholdDirection.LowerIsWorse,
        },
      }),
    ]);

    expect(
      screen.getByTestId("table-column-thresholds-reversed-cpu"),
    ).toHaveTextContent("Critical should be at or above Warning.");
    expect(
      screen.getByTestId("table-column-thresholds-reversed-free"),
    ).toHaveTextContent("Critical should be at or below Warning.");
  });

  test("turning thresholds off takes them off the column altogether", () => {
    const onChange: ColumnsChange = renderEditor([
      plainColumn({ thresholds: { ...USAGE } }),
    ]);

    fireEvent.click(screen.getByTestId("table-column-thresholds-toggle-cpu"));

    expect(Object.keys(lastColumns(onChange)[0]!)).not.toContain("thresholds");
    expect(
      screen.queryByTestId("table-column-thresholds-warning-cpu"),
    ).not.toBeInTheDocument();
  });

  test("the legend is drawn the way the table colors: a cell's background when it fills cells", () => {
    renderEditor(
      [plainColumn({ thresholds: { ...USAGE } })],
      TableThresholdStyle.Background,
    );

    const legend: HTMLElement = screen.getByTestId(
      "table-column-thresholds-legend-cpu",
    );
    expect(legend.children[0]).toHaveClass("bg-amber-100", "text-amber-900");
    expect(legend.children[1]).toHaveClass("bg-red-100", "text-red-900");
  });
});

type FormChange = Mock<(component: DashboardBaseComponent) => void>;

function renderSettings(
  widgetArguments: Partial<DashboardTableComponent["arguments"]>,
): FormChange {
  const onFormChange: FormChange =
    jest.fn<(component: DashboardBaseComponent) => void>();

  render(
    <ArgumentsForm
      component={tableComponent(widgetArguments)}
      metrics={{
        metricTypes: METRIC_TYPES,
        telemetryAttributes: ["host.name"],
      }}
      onFormChange={onFormChange}
    />,
  );

  return onFormChange;
}

function lastArguments(onFormChange: FormChange): JSONObject {
  const calls: Array<[DashboardBaseComponent]> = onFormChange.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0].arguments as JSONObject;
}

describe("the table's Threshold colors", () => {
  const plainColumns: Array<TableColumn> = [plainColumn({})];

  test("are not asked while no shown column is colored", () => {
    renderSettings({ columns: plainColumns });

    expect(
      screen.queryByTestId("table-threshold-style"),
    ).not.toBeInTheDocument();
  });

  test("are not asked for a hidden column's thresholds", () => {
    renderSettings({
      columns: [plainColumn({ showAsColumn: false, thresholds: { ...USAGE } })],
    });

    expect(
      screen.queryByTestId("table-threshold-style"),
    ).not.toBeInTheDocument();
  });

  test("appear under the columns once one is colored, colored text first", () => {
    renderSettings({ columns: plainColumns });

    fireEvent.click(screen.getByTestId("table-column-thresholds-toggle-cpu"));

    const picker: HTMLElement = screen.getByTestId("table-threshold-style");
    expect(within(picker).getByText("Threshold colors")).toBeInTheDocument();
    expect(
      within(picker).getByRole("radio", { name: /Colored text/ }),
    ).toBeChecked();
    expect(
      within(picker).getByRole("radio", { name: /Colored background/ }),
    ).not.toBeChecked();
    expect(within(picker).getByRole("radiogroup")).toHaveAccessibleName(
      "Threshold colors",
    );
  });

  test("Colored background is saved on the table, and Colored text takes it off again", () => {
    const onFormChange: FormChange = renderSettings({
      columns: [plainColumn({ thresholds: { ...USAGE } })],
    });

    fireEvent.click(
      within(screen.getByTestId("table-threshold-style")).getByRole("radio", {
        name: /Colored background/,
      }),
    );
    expect(lastArguments(onFormChange)["thresholdStyle"]).toBe(
      TableThresholdStyle.Background,
    );
    // The columns are left as they were.
    expect(
      (
        lastArguments(onFormChange)["columns"] as unknown as Array<TableColumn>
      )[0]!.thresholds,
    ).toEqual(USAGE);

    fireEvent.click(
      within(screen.getByTestId("table-threshold-style")).getByRole("radio", {
        name: /Colored text/,
      }),
    );
    expect(Object.keys(lastArguments(onFormChange))).not.toContain(
      "thresholdStyle",
    );
  });

  test("each choice shows a critical value drawn its way", () => {
    renderSettings({ columns: [plainColumn({ thresholds: { ...USAGE } })] });

    expect(
      screen.getByTestId(
        `table-threshold-style-${TableThresholdStyle.Text}-visual`,
      ),
    ).toHaveClass("text-red-700");
    expect(
      screen.getByTestId(
        `table-threshold-style-${TableThresholdStyle.Background}-visual`,
      ),
    ).toHaveClass("bg-red-100", "text-red-900");
  });

  test("a saved Colored background is checked when the settings open", () => {
    renderSettings({
      columns: [plainColumn({ thresholds: { ...USAGE } })],
      thresholdStyle: TableThresholdStyle.Background,
    });

    expect(
      within(screen.getByTestId("table-threshold-style")).getByRole("radio", {
        name: /Colored background/,
      }),
    ).toBeChecked();
    // And the columns' legends are drawn that way.
    expect(
      screen.getByTestId("table-column-thresholds-legend-cpu").children[1],
    ).toHaveClass("bg-red-100");
  });

  test("a column's thresholds set in the card are what the widget saves", () => {
    const onFormChange: FormChange = renderSettings({ columns: plainColumns });

    fireEvent.click(screen.getByTestId("table-column-thresholds-toggle-cpu"));
    fireEvent.change(
      screen.getByTestId("table-column-thresholds-critical-cpu"),
      {
        target: { value: "95" },
      },
    );

    expect(
      (
        lastArguments(onFormChange)["columns"] as unknown as Array<TableColumn>
      )[0]!.thresholds,
    ).toEqual({
      warning: 80,
      critical: 95,
      direction: TableThresholdDirection.HigherIsWorse,
    });
  });
});

describe("finding the table by what it now does", () => {
  function matchedTypes(searchTerm: string): Array<string> {
    return searchWidgetCatalog(searchTerm).flatMap(
      (category: WidgetCatalogCategory): Array<string> => {
        return category.items.map((item: WidgetCatalogItem): string => {
          return item.type.toString();
        });
      },
    );
  }

  test("a search for threshold in Add Widget offers the metric Table beside the Value and the Gauge", () => {
    const types: Array<string> = matchedTypes("threshold");

    expect(types).toContain(DashboardComponentType.Table);
    expect(types).toContain(DashboardComponentType.Gauge);
  });

  test("a search for color offers it too", () => {
    expect(matchedTypes("color")).toContain(DashboardComponentType.Table);
  });
});
