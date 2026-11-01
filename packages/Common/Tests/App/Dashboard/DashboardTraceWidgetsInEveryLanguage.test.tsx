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
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The trace widgets on a dashboard, in every language
 * ---------------------------------------------------------------------------
 *
 * A dashboard's Trace List, Trace Chart and Trace Table name the same statuses
 * and kinds as the Traces pages, so they change with them: a reader must not
 * see "Error" on a widget and the language's word for it one click later. What
 * a widget shows from the telemetry (a span's name, an attribute's value) stays
 * as written, even when it spells one of those words.
 *
 * The REAL widgets are mounted against a mocked span list and a mocked trace
 * analytics endpoint, under an i18next instance per language. recharts is
 * replaced by a probe that prints what each series is handed, as in
 * DashboardTraceStatusWidgets.test.tsx, and the honeycomb gets a stand-in
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
        { "data-testid": testId },
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
    Bar: series("chart-series"),
    Line: series("chart-series"),
    Area: series("chart-series"),
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
import DashboardTraceTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceTableComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import { TimeseriesRow } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/TraceChartData";
import {
  SPAN_STATUS_PRESENTATIONS,
  SpanStatusPresentation,
  getSpanStatusPresentation,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SpanStatusPresentation";
import Span, { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardTraceChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTraceChartComponent";
import DashboardTraceListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTraceListComponent";
import DashboardTraceTableComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTraceTableComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  LANGUAGES,
  PSEUDO_LANGUAGE,
  createLanguageInstances,
  inLanguage,
  word,
} from "./TracesLanguageHarness";

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

const widgetProps: () => DashboardBaseComponentProps =
  (): DashboardBaseComponentProps => {
    return {
      componentId: COMPONENT_ID,
      isEditMode: false,
      isSelected: false,
      key: "trace-widget",
      onComponentUpdate: (): void => {
        // No widget writes back through this.
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

const SPANS: Array<[string, SpanStatus | undefined]> = [
  ["GET /health", SpanStatus.Unset],
  ["POST /orders", SpanStatus.Ok],
  ["POST /pay", SpanStatus.Error],
  // A span that came back without a status at all.
  ["GET /legacy", undefined],
];

const renderTraceList: (
  language: string,
  args: DashboardTraceListComponent["arguments"],
) => void = (
  language: string,
  args: DashboardTraceListComponent["arguments"],
): void => {
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
    inLanguage(
      language,
      <DashboardTraceListComponentElement
        {...widgetProps()}
        component={component}
      />,
    ),
  );
};

const renderTraceChart: (language: string, groupBy?: string) => void = (
  language: string,
  groupBy: string = "statusCode",
): void => {
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
    arguments: { metric: "count", groupByAttribute: groupBy },
  };

  render(
    inLanguage(
      language,
      <DashboardTraceChartComponentElement
        {...widgetProps()}
        component={component}
      />,
    ),
  );
};

const renderTraceTable: (language: string, groupBy: string) => void = (
  language: string,
  groupBy: string,
): void => {
  const component: DashboardTraceTableComponent = {
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
      groupByAttribute: groupBy,
      topLimit: 10,
    } as DashboardTraceTableComponent["arguments"],
  };

  render(
    inLanguage(
      language,
      <DashboardTraceTableComponentElement
        {...widgetProps()}
        component={component}
      />,
    ),
  );
};

const tableRow: (groupValues: Record<string, string>) => JSONObject = (
  groupValues: Record<string, string>,
): JSONObject => {
  return {
    groupValues,
    count: 120,
    errorCount: 4,
    avgDurationMs: 10,
    p50DurationMs: 9,
    p90DurationMs: 20,
    p95DurationMs: 25,
    p99DurationMs: 40,
    minDurationMs: 1,
    maxDurationMs: 80,
  };
};

const statusRow: (statusCode: string, value: number) => TimeseriesRow = (
  statusCode: string,
  value: number,
): TimeseriesRow => {
  return {
    time: "2026-09-28T10:00:00.000Z",
    value,
    groupValues: { statusCode },
  };
};

const rowFor: (spanName: string) => HTMLElement = (
  spanName: string,
): HTMLElement => {
  const row: HTMLElement | null = screen.getByText(spanName).closest("tr");

  expect(row).not.toBeNull();

  return row as HTMLElement;
};

// What the table's first group column drew, row by row.
const groupCells: () => Array<string> = (): Array<string> => {
  return Array.from(document.querySelectorAll("tbody tr")).map(
    (row: Element): string => {
      return row.querySelectorAll("td")[1]?.textContent || "";
    },
  );
};

// What the chart calls each series.
const seriesNames: () => Array<string> = (): Array<string> => {
  return screen
    .queryAllByTestId("chart-series")
    .map((element: HTMLElement): string => {
      return (
        element.getAttribute("data-name") ||
        element.getAttribute("data-key") ||
        ""
      );
    });
};

// The honeycomb's legend, in order: the label beside each colored swatch.
const legendLabels: () => Array<string> = (): Array<string> => {
  return Array.from(
    document.body.querySelectorAll<HTMLElement>(
      'span[style*="background-color"]',
    ),
  ).map((swatch: HTMLElement): string => {
    return swatch.parentElement?.textContent || "";
  });
};

let originalResizeObserver: PropertyDescriptor | undefined;

beforeAll(async () => {
  await createLanguageInstances();
});

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
    const spans: Array<Span> = SPANS.map(
      (entry: [string, SpanStatus | undefined]): Span => {
        return buildSpan(entry[0], entry[1]);
      },
    );

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

describe.each(LANGUAGES)("the trace widgets in %s", (language: string) => {
  test("the list names each span's status, and says on hover what it means", async () => {
    renderTraceList(language, { viewMode: "list" });

    await screen.findByText("GET /health");

    for (const [name, status] of SPANS) {
      const presentation: SpanStatusPresentation =
        getSpanStatusPresentation(status);
      const pill: HTMLElement = within(rowFor(name)).getByText(
        word(language, presentation.label),
      );

      expect(pill).toHaveAttribute(
        "title",
        word(language, presentation.description),
      );
    }
  });

  test("the list keeps each span's name as written", async () => {
    renderTraceList(language, { viewMode: "list" });

    for (const [name] of SPANS) {
      expect(await screen.findByText(name)).toBeInTheDocument();
    }
  });

  test("a span called what a status is called stays as written", async () => {
    analyticsGetListMock.mockImplementation(async () => {
      return { data: [buildSpan("Error", SpanStatus.Ok)], count: 1 };
    });

    renderTraceList(language, { viewMode: "list" });

    expect(
      await screen.findByText(
        (content: string, element: Element | null): boolean => {
          return content === "Error" && element?.tagName !== "TITLE";
        },
      ),
    ).toBeInTheDocument();
  });

  test("the honeycomb's legend names each status", async () => {
    renderTraceList(language, { viewMode: "honeycomb" });

    await waitFor(() => {
      expect(legendLabels()).toHaveLength(SPAN_STATUS_PRESENTATIONS.length);
    });

    expect(legendLabels()).toEqual(
      SPAN_STATUS_PRESENTATIONS.map(
        (presentation: SpanStatusPresentation): string => {
          return word(language, presentation.displayLabel);
        },
      ),
    );
  });

  test("a chart split by status names each series", async () => {
    apiPostMock.mockImplementation(async () => {
      return {
        data: {
          data: [statusRow("0", 40), statusRow("1", 3), statusRow("2", 2)],
        },
      };
    });

    renderTraceChart(language);

    await screen.findByTestId("bar-chart");

    expect(seriesNames().sort()).toEqual(
      SPAN_STATUS_PRESENTATIONS.map(
        (presentation: SpanStatusPresentation): string => {
          return word(language, presentation.displayLabel);
        },
      ).sort(),
    );
  });

  test("a chart split by anything else keeps its series as written", async () => {
    apiPostMock.mockImplementation(async () => {
      return {
        data: {
          data: [
            {
              time: "2026-09-28T10:00:00.000Z",
              value: 3,
              groupValues: { "http.route": "Error" },
            },
          ],
        },
      };
    });

    renderTraceChart(language, "http.route");

    await screen.findByTestId("bar-chart");

    expect(seriesNames()).toEqual(["Error"]);
  });

  test("a table grouped by status names each row", async () => {
    apiPostMock.mockImplementation(async () => {
      return {
        data: {
          data: [
            tableRow({ statusCode: "0" }),
            tableRow({ statusCode: "1" }),
            tableRow({ statusCode: "2" }),
            tableRow({ statusCode: "" }),
          ],
        },
      };
    });

    renderTraceTable(language, "statusCode");

    await waitFor(() => {
      expect(groupCells()).toHaveLength(4);
    });

    expect(groupCells()).toEqual([
      word(language, "Unset (no error)"),
      word(language, "Ok"),
      word(language, "Error"),
      word(language, "(empty)"),
    ]);
  });

  test("a table grouped by kind names each row", async () => {
    apiPostMock.mockImplementation(async () => {
      return {
        data: {
          data: [
            tableRow({ kind: "2" }),
            tableRow({ kind: "3" }),
            tableRow({ kind: "9" }),
          ],
        },
      };
    });

    renderTraceTable(language, "kind");

    await waitFor(() => {
      expect(groupCells()).toHaveLength(3);
    });

    expect(groupCells()).toEqual([
      word(language, "Server"),
      word(language, "Client"),
      // A kind nothing names is shown as stored.
      "9",
    ]);
  });

  test("a table grouped by a person's own attribute keeps it as written", async () => {
    apiPostMock.mockImplementation(async () => {
      return {
        data: {
          data: [
            tableRow({ "http.route": "Error" }),
            tableRow({ "http.route": "Server" }),
          ],
        },
      };
    });

    renderTraceTable(language, "http.route");

    await waitFor(() => {
      expect(groupCells()).toHaveLength(2);
    });

    expect(groupCells()).toEqual(["Error", "Server"]);
  });
});

describe("in a language that marks every key, a status never skips translation", () => {
  test("the list's pills and their hover text", async () => {
    renderTraceList(PSEUDO_LANGUAGE, { viewMode: "list" });

    await screen.findByText("GET /health");

    for (const [name] of SPANS) {
      const row: HTMLElement = rowFor(name);
      const pill: HTMLElement | null = row.querySelector("[title]");

      expect(pill?.textContent).toMatch(/^⟦.+⟧$/u);
      expect(pill?.getAttribute("title")).toMatch(/^⟦.+⟧$/u);
    }
  });

  test("the honeycomb's legend", async () => {
    renderTraceList(PSEUDO_LANGUAGE, { viewMode: "honeycomb" });

    await waitFor(() => {
      expect(legendLabels()).toHaveLength(SPAN_STATUS_PRESENTATIONS.length);
    });

    for (const label of legendLabels()) {
      expect(label).toMatch(/^⟦.+⟧$/u);
    }
  });
});

describe("English reads as it always did", () => {
  test("the list and the legend", async () => {
    renderTraceList("en", { viewMode: "list" });

    await screen.findByText("POST /pay");

    expect(within(rowFor("POST /pay")).getByText("Error")).toBeInTheDocument();
    expect(within(rowFor("POST /orders")).getByText("Ok")).toBeInTheDocument();
    expect(
      within(rowFor("GET /health")).getByText("Unset"),
    ).toBeInTheDocument();
  });
});
