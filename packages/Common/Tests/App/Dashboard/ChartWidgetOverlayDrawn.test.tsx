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
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ISSUE #9961, AS A READER SEES IT: THE CHART WIDGET DRAWS OVERLAID QUERIES
 * ON ONE CHART.
 *
 * The real Chart widget (DashboardChartComponent) and the real charts
 * (MetricCharts, ChartGroup, the line chart) draw a widget's queries, with
 * the metrics read stood in for and recharts given a size to draw in:
 *
 *   - the issue's chart, mem_used and mem_total: two charts in the widget
 *     until mem_total's switch is on, then one chart with both lines;
 *   - the switch saved with the dashboard, read back as the board reads it,
 *     drawn as one chart, and opened again in the settings with it on; and
 *     a public dashboard's served copy draws it the same;
 *   - a dashboard saved before the switch existed draws exactly as before:
 *     a chart per query;
 *   - three queries chain onto one chart, or two, as their switches say,
 *     each line and legend chip named and colored apart;
 *   - units: one chart's axis, and a query in a unit it cannot read named
 *     in the chart's warning.
 */

jest.setTimeout(120000);

jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts") as Record<
    string,
    any
  >;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, {
        width: 600,
        height: 300,
      } as Record<string, unknown>);
    },
  };
});

const fetchResultsMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<any>) => {
          return fetchResultsMock(...args);
        },
        fetchExemplars: () => {
          return new Promise(() => {
            // Exemplars are not under test: they never arrive.
          });
        },
        setQueryTopNOverride: () => {
          return undefined;
        },
        getQueryConfigTopNKey: (
          _queryConfig: unknown,
          index: number,
          scope?: string,
        ) => {
          return `${scope || ""}:${index}`;
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
        serializeAttributeFiltersForKey: (attributes: unknown) => {
          return JSON.stringify(attributes || {});
        },
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
      },
      DEFAULT_TOP_N_SERIES: 10,
      SHOW_ALL_SERIES_TOP_N: 10_000,
      sanitizeAttributeFilters: (attributes: unknown) => {
        return attributes;
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return "11111111-1111-4111-8111-111111111111";
      },
    },
  };
});

import DashboardChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import ArgumentsForm, {
  METRIC_QUERY_ROW_HEADER_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm";
import { OVERLAY_UNIT_MISMATCH_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts";
import PublicDashboardViewConfig from "../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardChartComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { CHART_TITLE_ROW_TEST_ID } from "../../../UI/Components/Charts/ChartGroup/ChartGroup";
import StoredDashboardViewConfig from "../../../Utils/Dashboard/StoredDashboardViewConfig";

const COMPONENT_ID: ObjectID = new ObjectID(
  "99610000-1111-4111-8111-999610009961",
);

const WINDOW_START: Date = new Date("2026-11-18T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-11-18T11:00:00.000Z");

const WINDOW: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
};

const OVERLAY_SWITCH: string = "Overlay with previous query";

function metricType(name: string, unit: string): MetricType {
  const type: MetricType = new MetricType();
  type.name = name;
  type.unit = unit;
  return type;
}

const METRIC_TYPES: Array<MetricType> = [
  metricType("mem_used", "By"),
  metricType("mem_total", "By"),
  metricType("mem_free", "By"),
  metricType("cpu_usage_percent", "%"),
];

// What the host sends, by metric: a point every ten minutes of the window.
const VALUES: Record<string, Array<number>> = {
  mem_used: [4.1e9, 4.4e9, 4.2e9, 4.6e9, 4.5e9, 4.3e9],
  mem_total: [8e9, 8e9, 8e9, 8e9, 8e9, 8e9],
  mem_free: [3.9e9, 3.6e9, 3.8e9, 3.4e9, 3.5e9, 3.7e9],
  cpu_usage_percent: [12, 18, 25, 22, 17, 14],
};

function rowsOf(metricName: string): Array<AggregatedModel> {
  return (VALUES[metricName] || []).map(
    (value: number, step: number): AggregatedModel => {
      return {
        timestamp: new Date(WINDOW_START.getTime() + step * 10 * 60 * 1000),
        value: value,
      } as AggregatedModel;
    },
  );
}

function answer(metricViewData: MetricViewData): Array<AggregatedResult> {
  return metricViewData.queryConfigs.map(
    (queryConfig: MetricQueryConfigData): AggregatedResult => {
      return {
        data: rowsOf(String(queryConfig.metricQueryData.filterData.metricName)),
        truncated: false,
      } as AggregatedResult;
    },
  );
}

function query(
  variable: string,
  metricName: string,
  extra: Partial<MetricQueryConfigData> = {},
): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: metricName,
      description: undefined,
      legend: metricName,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: metricName,
        aggegationType: MetricsAggregationType.Avg,
      },
    },
    ...extra,
  } as MetricQueryConfigData;
}

const OVERLAID: Partial<MetricQueryConfigData> = {
  overlayWithPreviousQuery: true,
};

function chartOf(
  primary: MetricQueryConfigData,
  added: Array<MetricQueryConfigData>,
): DashboardChartComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.Chart,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 6,
    minWidthInDashboardUnits: 6,
    minHeightInDashboardUnits: 3,
    arguments: {
      chartTitle: "Memory",
      chartType: DashboardChartType.Line,
      metricQueryConfig: primary,
      metricQueryConfigs: added,
    },
  } as DashboardChartComponent;
}

// The issue's chart: mem_used, then mem_total, overlaid or not.
function memoryChart(isOverlaid: boolean): DashboardChartComponent {
  return chartOf(query("a", "mem_used"), [
    query("b", "mem_total", isOverlaid ? OVERLAID : {}),
  ]);
}

function boardOf(component: DashboardBaseComponent): DashboardViewConfig {
  return {
    _type: ObjectType.DashboardViewConfig,
    components: [component],
    heightInDashboardUnits: 12,
  };
}

function widgetProps(): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "memory-chart",
    onComponentUpdate: (): void => {
      // The widget under test never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 640,
    dashboardComponentWidthInPx: 640,
    dashboardViewConfig: boardOf(memoryChart(false)),
    dashboardStartAndEndDate: WINDOW,
    metricTypes: METRIC_TYPES,
    refreshTick: 0,
    variables: undefined,
  } as DashboardBaseComponentProps;
}

function widgetOf(component: DashboardChartComponent): React.ReactElement {
  return (
    <DashboardChartComponentElement {...widgetProps()} component={component} />
  );
}

// The lines a chart draws: recharts' line layers, less their hit areas.
function linesIn(plot: Element): Array<Element> {
  return Array.from(plot.querySelectorAll("g.recharts-line")).filter(
    (line: Element): boolean => {
      return !(line.getAttribute("class") || "").includes("cursor-pointer");
    },
  );
}

// Every chart drawn, and each of them with its lines drawn.
async function waitForChartsDrawn(): Promise<void> {
  await waitFor(() => {
    const plots: Array<HTMLElement> = screen.getAllByTestId("chart-group-plot");

    expect(plots.length).toBeGreaterThan(0);
    for (const plot of plots) {
      expect(linesIn(plot).length).toBeGreaterThan(0);
    }
  });
}

async function drawWidget(
  component: DashboardChartComponent,
): Promise<RenderResult> {
  const result: RenderResult = render(widgetOf(component));

  await waitForChartsDrawn();

  return result;
}

interface DrawnChart {
  title: string;
  // The legend's chips, by the series each names.
  series: Array<string>;
  // The color each chip's dot is drawn in.
  chipColors: Array<string>;
  // The lines drawn on the chart, by their stroke's color.
  lineColors: Array<string>;
}

// A legend chip's dot class ("bg-indigo-500"), or a line's ("stroke-indigo-500").
const COLOR_CLASS: RegExp = /^(bg|stroke)-/;

// A legend chip says what pressing it does after the series' name.
const CHIP_TITLE_END: RegExp = / — click to hide$/;

function colorOf(element: Element | null): string {
  if (!element) {
    return "";
  }

  const style: string = (element as HTMLElement).style?.backgroundColor || "";

  if (style) {
    return style;
  }

  const className: string = element.getAttribute("class") || "";
  const color: string | undefined = className
    .split(/\s+/)
    .find((name: string): boolean => {
      return COLOR_CLASS.test(name);
    });

  return (color || "").replace(COLOR_CLASS, "");
}

// Every chart the widget draws, as a reader reads it.
function drawnCharts(scope?: HTMLElement): Array<DrawnChart> {
  const plots: Array<HTMLElement> = scope
    ? within(scope).queryAllByTestId("chart-group-plot")
    : screen.queryAllByTestId("chart-group-plot");

  return plots.map((plot: HTMLElement): DrawnChart => {
    const panel: HTMLElement = plot.parentElement as HTMLElement;
    const chips: Array<HTMLElement> = within(panel)
      .queryAllByRole("button")
      .filter((button: HTMLElement): boolean => {
        return CHIP_TITLE_END.test(button.getAttribute("title") || "");
      });

    return {
      // The chart's own title, without the zoom hint its row also holds.
      title:
        within(panel).getByTestId(CHART_TITLE_ROW_TEST_ID).querySelector("h3")
          ?.textContent || "",
      series: chips.map((chip: HTMLElement): string => {
        return (chip.getAttribute("title") || "").replace(CHIP_TITLE_END, "");
      }),
      chipColors: chips.map((chip: HTMLElement): string => {
        return colorOf(chip.querySelector("span[aria-hidden='true']"));
      }),
      lineColors: linesIn(plot).map((line: Element): string => {
        return colorOf(line);
      }),
    };
  });
}

function seriesOf(charts: Array<DrawnChart>): Array<Array<string>> {
  return charts.map((chart: DrawnChart): Array<string> => {
    return [...chart.series].sort();
  });
}

function expectApart(colors: Array<string>): void {
  expect(colors.every(Boolean)).toBe(true);
  expect(new Set(colors).size).toBe(colors.length);
}

// The dashboard as DashboardView saves it, and as the board reads it back.
function saveAndReadBack(component: DashboardBaseComponent): {
  stored: JSONObject;
  read: DashboardChartComponent;
} {
  const stored: JSONObject = JSON.parse(
    JSON.stringify(
      JSONFunctions.serializeValue(boardOf(component) as unknown as JSONObject),
    ),
  ) as JSONObject;

  const read: DashboardViewConfig = StoredDashboardViewConfig.read(stored);

  return {
    stored,
    read: read.components[0] as unknown as DashboardChartComponent,
  };
}

beforeEach(() => {
  fetchResultsMock.mockReset();
  fetchResultsMock.mockImplementation((input: unknown) => {
    return Promise.resolve(
      answer((input as { metricViewData: MetricViewData }).metricViewData),
    );
  });
});

afterEach(() => {
  cleanup();
});

describe("the issue's chart: mem_used and mem_total", () => {
  test("switch off: a chart for each query, stacked in the widget, as before", async () => {
    await drawWidget(memoryChart(false));

    const charts: Array<DrawnChart> = drawnCharts();

    expect(seriesOf(charts)).toEqual([["mem_used"], ["mem_total"]]);
    expect(
      charts.map((chart: DrawnChart): string => {
        return chart.title;
      }),
    ).toEqual(["mem_used", "mem_total"]);
    for (const chart of charts) {
      expect(chart.lineColors).toHaveLength(1);
    }
  });

  test("switch on: one chart, both lines on the same axes", async () => {
    await drawWidget(memoryChart(true));

    const charts: Array<DrawnChart> = drawnCharts();

    expect(seriesOf(charts)).toEqual([["mem_total", "mem_used"]]);
    expect(charts[0]!.lineColors).toHaveLength(2);
    expect(screen.getByText("2 series")).toBeInTheDocument();
    // Both read on the same axis: no warning about units.
    expect(screen.queryByTestId(OVERLAY_UNIT_MISMATCH_TEST_ID)).toBeNull();
  });

  test("the legend and the lines tell the two apart, each chip the color of its line", async () => {
    await drawWidget(memoryChart(true));

    const [chart] = drawnCharts();

    expectApart(chart!.chipColors);
    expectApart(chart!.lineColors);
    expect([...chart!.chipColors].sort()).toEqual(
      [...chart!.lineColors].sort(),
    );
  });

  test("on, then off again: back to a chart for each query", async () => {
    const result: RenderResult = await drawWidget(memoryChart(true));

    expect(drawnCharts()).toHaveLength(1);

    result.rerender(widgetOf(memoryChart(false)));

    await waitFor(() => {
      expect(drawnCharts()).toHaveLength(2);
    });
    expect(seriesOf(drawnCharts())).toEqual([["mem_used"], ["mem_total"]]);
  });

  test("Query 1 saved with the switch on draws its own chart all the same", async () => {
    await drawWidget(
      chartOf(query("a", "mem_used", OVERLAID), [query("b", "mem_total")]),
    );

    expect(seriesOf(drawnCharts())).toEqual([["mem_used"], ["mem_total"]]);
  });

  test("the widget reads each query once, overlaid or not", async () => {
    await drawWidget(memoryChart(true));

    const read: MetricViewData = (
      fetchResultsMock.mock.calls[0]![0] as { metricViewData: MetricViewData }
    ).metricViewData;

    expect(
      read.queryConfigs.map((queryConfig: MetricQueryConfigData): string => {
        return String(queryConfig.metricQueryData.filterData.metricName);
      }),
    ).toEqual(["mem_used", "mem_total"]);
  });
});

describe("saved, read back and opened again", () => {
  // The settings form, as the widget's settings dialog draws it.
  function drawSettings(
    component: DashboardChartComponent,
    onFormChange: (component: DashboardBaseComponent) => void,
  ): RenderResult {
    return render(
      <ArgumentsForm
        component={component as unknown as DashboardBaseComponent}
        metrics={{ metricTypes: METRIC_TYPES, telemetryAttributes: [] }}
        onFormChange={onFormChange}
      />,
    );
  }

  function secondQuerySwitch(): HTMLElement {
    const card: HTMLElement = screen.getAllByTestId(
      METRIC_QUERY_ROW_HEADER_TEST_ID,
    )[0]!.parentElement as HTMLElement;

    fireEvent.click(
      within(card).getByRole("button", { name: "Display Settings" }),
    );

    return within(card).getByRole("switch", { name: OVERLAY_SWITCH });
  }

  test("turned on in the settings, saved, read back: one chart, and the switch is still on", async () => {
    let edited: DashboardChartComponent | null = null;

    const settings: RenderResult = drawSettings(
      memoryChart(false),
      (component: DashboardBaseComponent): void => {
        edited = component as unknown as DashboardChartComponent;
      },
    );

    fireEvent.click(secondQuerySwitch());
    expect(edited).not.toBeNull();
    settings.unmount();

    const { stored, read } = saveAndReadBack(edited!);

    // The setting is in what the dashboard stores, on the added query.
    expect(JSON.stringify(stored)).toContain('"overlayWithPreviousQuery":true');
    expect(
      read.arguments.metricQueryConfigs?.[0]?.overlayWithPreviousQuery,
    ).toBe(true);

    // Drawn from what was read back: one chart with both lines.
    const widget: RenderResult = await drawWidget(read);

    expect(seriesOf(drawnCharts())).toEqual([["mem_total", "mem_used"]]);
    widget.unmount();

    // Opened again: the switch is on.
    drawSettings(read, (): void => {});

    expect(secondQuerySwitch()).toHaveAttribute("aria-checked", "true");
  });

  test("turned off in the reopened settings and saved again: a chart for each query", async () => {
    let edited: DashboardChartComponent | null = null;

    const settings: RenderResult = drawSettings(
      saveAndReadBack(memoryChart(true)).read,
      (component: DashboardBaseComponent): void => {
        edited = component as unknown as DashboardChartComponent;
      },
    );

    fireEvent.click(secondQuerySwitch());
    settings.unmount();

    const { stored, read } = saveAndReadBack(edited!);

    expect(JSON.stringify(stored)).not.toContain("overlayWithPreviousQuery");

    await drawWidget(read);

    expect(seriesOf(drawnCharts())).toEqual([["mem_used"], ["mem_total"]]);
  });

  test("a public dashboard's served copy draws it the same: one chart", async () => {
    const { stored } = saveAndReadBack(memoryChart(true));

    const served: DashboardViewConfig | null =
      PublicDashboardViewConfig.sanitize(
        stored as unknown as DashboardViewConfig,
      );
    const read: DashboardViewConfig = StoredDashboardViewConfig.read(
      JSON.parse(JSON.stringify(served)) as JSONObject,
    );

    await drawWidget(read.components[0] as unknown as DashboardChartComponent);

    expect(seriesOf(drawnCharts())).toEqual([["mem_total", "mem_used"]]);
  });
});

describe("a dashboard saved before the switch existed draws exactly as before", () => {
  /*
   * A Chart widget as a dashboard stored it before this change: two queries,
   * no overlay setting anywhere.
   */
  const SAVED_BEFORE: JSONObject = {
    _type: "DashboardViewConfig",
    heightInDashboardUnits: 12,
    components: [
      {
        _type: "DashboardComponent",
        componentId: { _type: "ObjectID", value: COMPONENT_ID.toString() },
        componentType: "Chart",
        topInDashboardUnits: 0,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 6,
        heightInDashboardUnits: 6,
        minWidthInDashboardUnits: 6,
        minHeightInDashboardUnits: 3,
        arguments: {
          chartTitle: "Memory",
          chartType: "Line",
          metricQueryConfig: {
            metricAliasData: {
              metricVariable: "a",
              title: "mem_used",
              legend: "mem_used",
            },
            metricQueryData: {
              filterData: { metricName: "mem_used", aggegationType: "Avg" },
            },
          },
          metricQueryConfigs: [
            {
              metricAliasData: {
                metricVariable: "b",
                title: "mem_total",
                legend: "mem_total",
              },
              metricQueryData: {
                filterData: { metricName: "mem_total", aggegationType: "Avg" },
              },
            },
          ],
        },
      },
    ],
  };

  test("read back, it draws a chart per query", async () => {
    const read: DashboardViewConfig =
      StoredDashboardViewConfig.read(SAVED_BEFORE);

    await drawWidget(read.components[0] as unknown as DashboardChartComponent);

    const charts: Array<DrawnChart> = drawnCharts();

    expect(seriesOf(charts)).toEqual([["mem_used"], ["mem_total"]]);
    expect(
      charts.map((chart: DrawnChart): string => {
        return chart.title;
      }),
    ).toEqual(["mem_used", "mem_total"]);
  });

  test("read back and saved again unchanged, it gains no overlay setting", () => {
    const read: DashboardViewConfig =
      StoredDashboardViewConfig.read(SAVED_BEFORE);
    const { stored } = saveAndReadBack(
      read.components[0] as unknown as DashboardBaseComponent,
    );

    expect(JSON.stringify(stored)).not.toContain("overlayWithPreviousQuery");
  });
});

describe("three queries chain onto the charts their switches say", () => {
  test("Query 2 and Query 3 on: one chart, three lines, three colors", async () => {
    await drawWidget(
      chartOf(query("a", "mem_used"), [
        query("b", "mem_total", OVERLAID),
        query("c", "mem_free", OVERLAID),
      ]),
    );

    const charts: Array<DrawnChart> = drawnCharts();

    expect(seriesOf(charts)).toEqual([["mem_free", "mem_total", "mem_used"]]);
    expect(charts[0]!.title).toBe("mem_used");
    expect(charts[0]!.lineColors).toHaveLength(3);
    expectApart(charts[0]!.chipColors);
    expectApart(charts[0]!.lineColors);
    expect(screen.getByText("3 series")).toBeInTheDocument();
  });

  test("Query 2 on, Query 3 off: Query 3 starts a chart of its own", async () => {
    await drawWidget(
      chartOf(query("a", "mem_used"), [
        query("b", "mem_total", OVERLAID),
        query("c", "mem_free"),
      ]),
    );

    expect(seriesOf(drawnCharts())).toEqual([
      ["mem_total", "mem_used"],
      ["mem_free"],
    ]);
  });

  test("Query 2 off, Query 3 on: Query 3 joins Query 2's chart, not Query 1's", async () => {
    await drawWidget(
      chartOf(query("a", "mem_used"), [
        query("b", "mem_total"),
        query("c", "mem_free", OVERLAID),
      ]),
    );

    const charts: Array<DrawnChart> = drawnCharts();

    expect(seriesOf(charts)).toEqual([["mem_used"], ["mem_free", "mem_total"]]);
    expect(charts[1]!.title).toBe("mem_total");
  });

  test("the same metric three times, legends left empty: each line is named apart by its letter", async () => {
    const unnamed: (
      variable: string,
      extra?: Partial<MetricQueryConfigData>,
    ) => MetricQueryConfigData = (
      variable: string,
      extra: Partial<MetricQueryConfigData> = {},
    ): MetricQueryConfigData => {
      return query(variable, "mem_used", {
        metricAliasData: {
          metricVariable: variable,
          title: undefined,
          description: undefined,
          legend: undefined,
          legendUnit: undefined,
        },
        ...extra,
      });
    };

    await drawWidget(
      chartOf(unnamed("a"), [unnamed("b", OVERLAID), unnamed("c", OVERLAID)]),
    );

    const [chart] = drawnCharts();

    expect([...chart!.series].sort()).toEqual([
      "mem_used (a)",
      "mem_used (b)",
      "mem_used (c)",
    ]);
    expect(chart!.lineColors).toHaveLength(3);
    expectApart(chart!.chipColors);
  });

  test("a color picked for a query stays that query's on the shared chart", async () => {
    await drawWidget(
      chartOf(query("a", "mem_used", { color: "#0EA5E9" }), [
        query("b", "mem_total", { ...OVERLAID, color: "#F97316" }),
      ]),
    );

    const [chart] = drawnCharts();
    const colorOfSeries: Record<string, string> = {};

    chart!.series.forEach((name: string, index: number): void => {
      colorOfSeries[name] = chart!.chipColors[index]!;
    });

    expect(colorOfSeries).toEqual({
      mem_used: "rgb(14, 165, 233)",
      mem_total: "rgb(249, 115, 22)",
    });
  });
});

describe("units on an overlaid chart", () => {
  test("percent overlaid on a chart in bytes: drawn, and the chart says the units differ", async () => {
    await drawWidget(
      chartOf(query("a", "mem_used"), [
        query("b", "cpu_usage_percent", OVERLAID),
      ]),
    );

    expect(seriesOf(drawnCharts())).toEqual([
      ["cpu_usage_percent", "mem_used"],
    ]);
    expect(screen.getByTestId(OVERLAY_UNIT_MISMATCH_TEST_ID)).toHaveTextContent(
      "Overlaid queries use different units (Bytes, Percent) — they share one axis, so values may not be directly comparable.",
    );
  });

  test("gigabytes overlaid on a chart in bytes: converted, so nothing to warn about", async () => {
    await drawWidget(
      chartOf(query("a", "mem_used"), [
        query("b", "mem_total", {
          ...OVERLAID,
          metricAliasData: {
            metricVariable: "b",
            title: "mem_total",
            description: undefined,
            legend: "mem_total",
            legendUnit: "GB",
          },
        }),
      ]),
    );

    expect(drawnCharts()).toHaveLength(1);
    expect(screen.queryByTestId(OVERLAY_UNIT_MISMATCH_TEST_ID)).toBeNull();
  });

  test("the same units on charts of their own never warn", async () => {
    await drawWidget(
      chartOf(query("a", "mem_used"), [query("b", "cpu_usage_percent")]),
    );

    expect(drawnCharts()).toHaveLength(2);
    expect(screen.queryByTestId(OVERLAY_UNIT_MISMATCH_TEST_ID)).toBeNull();
  });
});

describe("the widget keeps its look while it loads", () => {
  test("an overlaid chart waits for its data as any chart does", async () => {
    let resolve: ((results: Array<AggregatedResult>) => void) | null = null;

    fetchResultsMock.mockImplementation(() => {
      return new Promise((done: (results: Array<AggregatedResult>) => void) => {
        resolve = done;
      });
    });

    render(widgetOf(memoryChart(true)));

    expect(screen.queryAllByTestId("chart-group-plot")).toHaveLength(0);

    await act(async () => {
      resolve!([
        { data: rowsOf("mem_used"), truncated: false } as AggregatedResult,
        { data: rowsOf("mem_total"), truncated: false } as AggregatedResult,
      ]);
    });

    await waitFor(() => {
      expect(seriesOf(drawnCharts())).toEqual([["mem_total", "mem_used"]]);
    });
  });
});
