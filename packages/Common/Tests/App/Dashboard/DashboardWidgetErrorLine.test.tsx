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
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ONE ERROR LINE FOR EVERY WIDGET (issue #7330).
 *
 * A widget that has nothing to draw because something went wrong - a read
 * that failed, a time range with no start or end - drew it its own way.
 * The Data Source Chart, the metric Table, the Log Stream, the Chart, the
 * Gauge, the Data Source Table and the Network Map drew it in gray-400
 * (2.5:1 on white) in a 160 or 192px column, most as it was set: "Please
 * select a valid start and end date." in English on a German or an Arabic
 * board. The log and trace charts, the trace table and the security
 * events flow drew it as a page's error, in larger words with a page's
 * margins.
 *
 * Here each real widget is drawn with its read standing in, on a board
 * whose time range has no start or end, or whose read fails, in English,
 * German and Arabic: each draws the one error line (DashboardWidgetError)
 * - in the reader's words, gray-500, centred, balanced, as wide as a line
 * reads well - and an English answer from a server keeps its own reading
 * direction on an Arabic board.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const fetchTimeSeriesMock: MockFunction = getJestMockFunction();
const fetchTableMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>) => {
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return react.createElement("div", { "data-testid": "metric-charts" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/DataSourceQuery",
  () => {
    return {
      __esModule: true,
      default: {
        fetchTimeSeries: (...args: Array<unknown>) => {
          return fetchTimeSeriesMock(...args);
        },
        fetchTable: (...args: Array<unknown>) => {
          return fetchTableMock(...args);
        },
        getAttributeKeys: (): Array<string> => {
          return [];
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: Error): string => {
        return error.message;
      },
      getFriendlyErrorMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      getList: (...args: Array<unknown>) => {
        return modelGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return analyticsGetListMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import DashboardChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent";
import DashboardDataSourceChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceChartComponent";
import DashboardDataSourceTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceTableComponent";
import DashboardGaugeComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardGaugeComponent";
import DashboardLogChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardLogChartComponent";
import DashboardLogStreamComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardLogStreamComponent";
import DashboardSecurityEventsFlowComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSecurityEventsFlowComponent";
import DashboardTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTableComponent";
import DashboardTraceChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceChartComponent";
import DashboardTraceTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceTableComponent";
import DashboardValueComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardValueComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import DashboardWidgetError, {
  DASHBOARD_WIDGET_ERROR_TEST_ID,
  DashboardWidgetErrorLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetError";
import {
  DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME,
  DASHBOARD_WIDGET_ERROR_LINE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetSetupCopy";
import { GAUGE_NO_DATA_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/GaugeWidgetView";
import WidgetPlaceholder, {
  WIDGET_PLACEHOLDER_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/WidgetPlaceholder";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { TableColumnKind } from "../../../Types/Dashboard/DashboardComponents/DashboardTableComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import IconProp from "../../../Types/Icon/IconProp";
import { ObjectType } from "../../../Types/JSON";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { getUnexplainedServerErrorMessage } from "../../../Types/Exception/UnexplainedError";
import ProjectUtil from "../../../UI/Utils/Project";
import DashboardChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardChartComponent";
import DashboardDataSourceChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardDataSourceChartComponent";
import DashboardDataSourceTableComponentUtil from "../../../Utils/Dashboard/Components/DashboardDataSourceTableComponent";
import DashboardGaugeComponentUtil from "../../../Utils/Dashboard/Components/DashboardGaugeComponent";
import DashboardLogChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardLogChartComponent";
import DashboardLogStreamComponentUtil from "../../../Utils/Dashboard/Components/DashboardLogStreamComponent";
import DashboardSecurityEventsFlowComponentUtil from "../../../Utils/Dashboard/Components/DashboardSecurityEventsFlowComponent";
import DashboardTableComponentUtil from "../../../Utils/Dashboard/Components/DashboardTableComponent";
import DashboardTraceChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardTraceChartComponent";
import DashboardTraceTableComponentUtil from "../../../Utils/Dashboard/Components/DashboardTraceTableComponent";
import DashboardValueComponentUtil from "../../../Utils/Dashboard/Components/DashboardValueComponent";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000007330",
);

const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-000000007330",
);

const BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-11-13T09:00:00.000Z"),
    new Date("2026-11-13T10:00:00.000Z"),
  ),
};

// A board whose custom time range has no start or end.
const NO_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: {
    startValue: null,
    endValue: null,
  } as unknown as InBetween<Date>,
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

const NO_TIME_RANGE: string = "Please select a valid start and end date.";

// A failed read's answer, in English, as a server or a connector words it.
const SERVER_ANSWER: string = "Connection refused by the metrics store.";

// The look every widget's error was drawn in before, and is never now.
const OLD_LOOK: RegExp = /\btext-gray-400\b|\bmax-w-48\b|\bmax-w-40\b/;

function baseProps(
  range: RangeStartAndEndDateTime = BOARD_RANGE,
): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "error-widget",
    onComponentUpdate: (): void => {
      // No widget writes back through this here.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 390,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: range,
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
    dashboardId: "d0000000-0000-4000-8000-000000007330",
  };
}

function withArguments(
  component: DashboardBaseComponent,
  widgetArguments: Record<string, unknown>,
): DashboardBaseComponent {
  return {
    ...component,
    componentId: COMPONENT_ID,
    arguments: {
      ...(component.arguments as Record<string, unknown>),
      ...widgetArguments,
    } as DashboardBaseComponent["arguments"],
  };
}

const METRIC_QUERY: Record<string, unknown> = {
  metricAliasData: {
    metricVariable: "a",
    title: undefined,
    description: undefined,
    legend: undefined,
    legendUnit: undefined,
  },
  metricQueryData: {
    filterData: {
      metricName: "http.requests",
      aggegationType: MetricsAggregationType.Sum,
    },
    groupBy: undefined,
  },
};

interface Widget {
  name: string;
  // What it draws in place of its data: its icon's kind.
  component: () => DashboardBaseComponent;
  element: (
    props: DashboardBaseComponentProps,
    component: DashboardBaseComponent,
  ) => React.ReactElement;
  // Whether it says a time range with no start or end is the problem.
  checksTheTimeRange: boolean;
  // Whether it draws the line under an icon of its own (the Gauge's arc).
  drawsItsOwnIcon?: boolean | undefined;
}

function elementOf(
  Element: React.FunctionComponent<any>,
): (
  props: DashboardBaseComponentProps,
  component: DashboardBaseComponent,
) => React.ReactElement {
  const drawn: (
    props: DashboardBaseComponentProps,
    component: DashboardBaseComponent,
  ) => React.ReactElement = (
    props: DashboardBaseComponentProps,
    component: DashboardBaseComponent,
  ): React.ReactElement => {
    return <Element {...props} component={component} />;
  };

  return drawn;
}

/*
 * Every widget that reads its own data and draws its own error, each set
 * up so it reads (a metric, a query) - a widget not set up yet says what
 * it needs instead (WidgetSetupLineEveryPlace).
 */
const WIDGETS: ReadonlyArray<Widget> = [
  {
    name: "Data Source Chart",
    component: () => {
      return withArguments(
        DashboardDataSourceChartComponentUtil.getDefaultComponent(),
        { queries: [{ id: "q1", dataSourceId: "ds-prom", query: "up" }] },
      );
    },
    element: elementOf(DashboardDataSourceChartComponentElement),
    checksTheTimeRange: true,
  },
  {
    name: "Table",
    component: () => {
      return withArguments(DashboardTableComponentUtil.getDefaultComponent(), {
        columns: [
          {
            id: "requests",
            variable: "a",
            header: "Requests",
            kind: TableColumnKind.Metric,
            metricName: "http.requests",
            aggregation: MetricsAggregationType.Sum,
          },
        ],
      });
    },
    element: elementOf(DashboardTableComponentElement),
    checksTheTimeRange: true,
  },
  {
    name: "Log Stream",
    component: () => {
      return withArguments(
        DashboardLogStreamComponentUtil.getDefaultComponent(),
        {},
      );
    },
    element: elementOf(DashboardLogStreamComponentElement),
    checksTheTimeRange: true,
  },
  {
    name: "Chart",
    component: () => {
      return withArguments(DashboardChartComponentUtil.getDefaultComponent(), {
        metricQueryConfig: METRIC_QUERY,
      });
    },
    element: elementOf(DashboardChartComponentElement),
    checksTheTimeRange: true,
  },
  {
    name: "Log Chart",
    component: () => {
      return withArguments(
        DashboardLogChartComponentUtil.getDefaultComponent(),
        {},
      );
    },
    element: elementOf(DashboardLogChartComponentElement),
    checksTheTimeRange: true,
  },
  {
    name: "Trace Chart",
    component: () => {
      return withArguments(
        DashboardTraceChartComponentUtil.getDefaultComponent(),
        {},
      );
    },
    element: elementOf(DashboardTraceChartComponentElement),
    checksTheTimeRange: true,
  },
  {
    name: "Trace Table",
    component: () => {
      return withArguments(
        DashboardTraceTableComponentUtil.getDefaultComponent(),
        {},
      );
    },
    element: elementOf(DashboardTraceTableComponentElement),
    checksTheTimeRange: true,
  },
  {
    name: "Security Events Flow",
    component: () => {
      return withArguments(
        DashboardSecurityEventsFlowComponentUtil.getDefaultComponent(),
        {},
      );
    },
    element: elementOf(DashboardSecurityEventsFlowComponentElement),
    checksTheTimeRange: true,
  },
  {
    name: "Data Source Table",
    component: () => {
      return withArguments(
        DashboardDataSourceTableComponentUtil.getDefaultComponent(),
        { query: { id: "q1", dataSourceId: "ds-pg", query: "select 1" } },
      );
    },
    element: elementOf(DashboardDataSourceTableComponentElement),
    checksTheTimeRange: false,
  },
  {
    name: "Gauge",
    component: () => {
      return withArguments(DashboardGaugeComponentUtil.getDefaultComponent(), {
        metricQueryConfig: METRIC_QUERY,
      });
    },
    element: elementOf(DashboardGaugeComponentElement),
    checksTheTimeRange: false,
    drawsItsOwnIcon: true,
  },
];

async function speak(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function inLanguage(english: string, language: string): string {
  if (language === "en") {
    return english;
  }

  const words: string | undefined = readDashboardLocale(language)[english];

  expect({ language, english, worded: Boolean(words) }).toEqual({
    language,
    english,
    worded: true,
  });

  return words as string;
}

// Every read fails, as an unreachable store answers.
function failEveryRead(): void {
  const refused: () => Promise<never> = (): Promise<never> => {
    return Promise.reject(new Error(SERVER_ANSWER));
  };

  fetchResultsMock.mockImplementation(refused);
  fetchTimeSeriesMock.mockImplementation(refused);
  fetchTableMock.mockImplementation(refused);
  postMock.mockImplementation(refused);
  analyticsGetListMock.mockImplementation(refused);
  modelGetListMock.mockImplementation(refused);
}

function readsMade(): number {
  return (
    fetchResultsMock.mock.calls.length +
    fetchTimeSeriesMock.mock.calls.length +
    fetchTableMock.mock.calls.length +
    postMock.mock.calls.length +
    analyticsGetListMock.mock.calls.length
  );
}

/*
 * The widget's error line, inside its error state - under the gauge's own
 * arc icon for the Gauge, which draws the line alone
 * (DashboardWidgetErrorLine).
 */
async function errorLine(widget: Widget): Promise<HTMLElement> {
  const line: HTMLElement = await screen.findByTestId(
    DASHBOARD_WIDGET_ERROR_LINE_TEST_ID,
  );

  if (widget.drawsItsOwnIcon) {
    expect(
      screen.queryByTestId(DASHBOARD_WIDGET_ERROR_TEST_ID),
    ).not.toBeInTheDocument();
  } else {
    expect(
      within(screen.getByTestId(DASHBOARD_WIDGET_ERROR_TEST_ID)).getByTestId(
        DASHBOARD_WIDGET_ERROR_LINE_TEST_ID,
      ),
    ).toBe(line);
  }

  return line;
}

// The line is the shared one: readable, centred, balanced, not too wide.
function expectTheSharedLook(widget: string, line: HTMLElement): void {
  expect({ widget, className: line.className }).toEqual({
    widget,
    className: DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME,
  });
  expect(line).toHaveClass(
    "text-xs",
    "text-gray-500",
    "text-center",
    "text-balance",
    "max-w-xs",
  );
  expect(line.className).not.toMatch(OLD_LOOK);
  // Never a page's error, with a page's margins and larger words.
  expect(line.closest(".my-10")).toBeNull();
  // Under the widget's icon.
  expect(line.parentElement!.querySelector("svg")).not.toBeNull();
  expect(line.parentElement!.firstElementChild!.contains(line)).toBe(false);
}

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar"];

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
      ar: { translation: readDashboardLocale("ar") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  for (const mock of [
    fetchResultsMock,
    fetchTimeSeriesMock,
    fetchTableMock,
    postMock,
    analyticsGetListMock,
    modelGetListMock,
  ]) {
    mock.mockReset();
  }

  fetchResultsMock.mockResolvedValue([]);
  fetchTimeSeriesMock.mockResolvedValue({ data: [] });
  fetchTableMock.mockResolvedValue({ columns: [], rows: [], truncated: false });
  postMock.mockResolvedValue({ data: {} });
  analyticsGetListMock.mockResolvedValue({ data: [], count: 0 });
  modelGetListMock.mockResolvedValue({ data: [], count: 0 });

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  window.localStorage.clear();
  await speak("en");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("a board whose time range has no start or end: every widget says so in the reader's words", () => {
  const cases: Array<[string, string, Widget]> = LANGUAGES.flatMap(
    (language: string): Array<[string, string, Widget]> => {
      return WIDGETS.filter((widget: Widget): boolean => {
        return widget.checksTheTimeRange;
      }).map((widget: Widget): [string, string, Widget] => {
        return [widget.name, language, widget];
      });
    },
  );

  test.each(cases)(
    "%s in %s",
    async (_name: string, language: string, widget: Widget) => {
      await speak(language);

      render(widget.element(baseProps(NO_RANGE), widget.component()));

      const line: HTMLElement = await errorLine(widget);

      expect(line).toHaveTextContent(inLanguage(NO_TIME_RANGE, language));

      if (language !== "en") {
        expect(line.textContent || "").not.toContain(NO_TIME_RANGE);
      }

      expectTheSharedLook(widget.name, line);
      expect(
        screen.queryByTestId(WIDGET_PLACEHOLDER_TEST_ID),
      ).not.toBeInTheDocument();
      expect(readsMade()).toBe(0);
    },
  );
});

describe("a read that fails: every widget says why, the server's words in their own direction", () => {
  const cases: Array<[string, string, Widget]> = ["en", "ar"].flatMap(
    (language: string): Array<[string, string, Widget]> => {
      return WIDGETS.map((widget: Widget): [string, string, Widget] => {
        return [widget.name, language, widget];
      });
    },
  );

  test.each(cases)(
    "%s in %s",
    async (_name: string, language: string, widget: Widget) => {
      await speak(language);
      failEveryRead();

      render(widget.element(baseProps(), widget.component()));

      const line: HTMLElement = await errorLine(widget);

      expect(line).toHaveTextContent(SERVER_ANSWER);
      expectTheSharedLook(widget.name, line);

      /*
       * On an Arabic board the English answer is set apart, left to right,
       * so its full stop stays at its end.
       */
      const isolated: Element | null = line.querySelector("bdi");

      if (language === "ar") {
        expect(isolated).not.toBeNull();
        expect(isolated).toHaveAttribute("dir", "ltr");
        expect(isolated).toHaveTextContent(SERVER_ANSWER);
      } else {
        expect(isolated).toBeNull();
      }

      expect(readsMade()).toBeGreaterThan(0);
    },
  );

  test.each([["en"], ["ar"]])(
    "the Value widget, in %s: its own clamped line, gray-500, the server's words in their direction",
    async (language: string) => {
      await speak(language);
      failEveryRead();

      render(
        <DashboardValueComponentElement
          {...baseProps()}
          component={
            withArguments(DashboardValueComponentUtil.getDefaultComponent(), {
              metricQueryConfig: METRIC_QUERY,
            }) as never
          }
        />,
      );

      const line: HTMLElement = await screen.findByTestId(
        DASHBOARD_WIDGET_ERROR_LINE_TEST_ID,
      );

      expect(line).toHaveTextContent(SERVER_ANSWER);
      expect(line).toHaveClass("text-xs", "text-gray-500", "text-center");
      expect(line.className).not.toMatch(OLD_LOOK);
      if (language === "ar") {
        expect(line).toHaveAttribute("dir", "ltr");
      } else {
        expect(line).not.toHaveAttribute("dir", "rtl");
      }
    },
  );
});

describe("the Gauge's line when it has no value: readable, and its reason in the reader's words", () => {
  test.each([
    ["en", "No data for the selected time range", []],
    ["de", "No data for the selected time range", []],
    [
      "de",
      "Invalid formula.",
      [{ data: [], errorMessage: "Invalid formula." }],
    ],
    [
      "ar",
      "Invalid formula.",
      [{ data: [], errorMessage: "Invalid formula." }],
    ],
  ])(
    "in %s: %s",
    async (
      language: string,
      english: string,
      results: Array<Partial<AggregatedResult>>,
    ) => {
      await speak(language);
      fetchResultsMock.mockResolvedValue(results);

      render(
        <DashboardGaugeComponentElement
          {...baseProps()}
          component={
            withArguments(DashboardGaugeComponentUtil.getDefaultComponent(), {
              metricQueryConfig: METRIC_QUERY,
            }) as never
          }
        />,
      );

      const line: HTMLElement = await screen.findByTestId(
        GAUGE_NO_DATA_TEST_ID,
      );

      expect(line).toHaveTextContent(inLanguage(english, language));
      expect(line.className).toBe(DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME);
      expect(line.className).not.toMatch(OLD_LOOK);
    },
  );
});

describe("the error line itself", () => {
  test("a failure nobody explained says why and what to do next, with its reference, and not what failed", () => {
    render(
      <DashboardWidgetError
        icon={IconProp.ChartBar}
        error={getUnexplainedServerErrorMessage("ab12cd34")}
      />,
    );

    const line: HTMLElement = screen.getByTestId(
      DASHBOARD_WIDGET_ERROR_LINE_TEST_ID,
    );

    expect(within(line).getByTestId("error-explanation")).toBeInTheDocument();
    expect(within(line).getByTestId("error-reference")).toHaveTextContent(
      "ab12cd34",
    );
    // The widget's icon above says what failed: the words do not repeat it.
    expect(line.textContent || "").not.toMatch(/This did not finish/);
    expect(line.textContent || "").not.toContain("{{reference}}");
  });

  test("a sentence a widget set is in the reader's words; one with no entry is drawn as written", async () => {
    await speak("de");

    const view: ReturnType<typeof render> = render(
      <DashboardWidgetErrorLine error={NO_TIME_RANGE} />,
    );

    expect(
      screen.getByTestId(DASHBOARD_WIDGET_ERROR_LINE_TEST_ID),
    ).toHaveTextContent(inLanguage(NO_TIME_RANGE, "de"));

    view.rerender(<DashboardWidgetErrorLine error={SERVER_ANSWER} />);

    expect(
      screen.getByTestId(DASHBOARD_WIDGET_ERROR_LINE_TEST_ID),
    ).toHaveTextContent(SERVER_ANSWER);
  });

  test("a widget that sizes the line to its tile gives its own look; the words are the same", () => {
    render(
      <DashboardWidgetErrorLine
        error={SERVER_ANSWER}
        className="text-xs text-gray-500 line-clamp-2"
      />,
    );

    const line: HTMLElement = screen.getByTestId(
      DASHBOARD_WIDGET_ERROR_LINE_TEST_ID,
    );

    expect(line.className).toBe("text-xs text-gray-500 line-clamp-2");
    expect(line).toHaveTextContent(SERVER_ANSWER);
  });

  test("the shared look: readable gray, centred, balanced, as wide as a line reads well", () => {
    const tokens: Array<string> =
      DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME.split(/\s+/);

    expect(tokens).toEqual(
      expect.arrayContaining([
        "text-xs",
        "text-gray-500",
        "text-center",
        "text-balance",
        "break-words",
        "max-w-xs",
      ]),
    );
    expect(DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME).not.toMatch(OLD_LOOK);
  });
});

/*
 * A list whose read failed, and a widget a public dashboard cannot draw,
 * say why in a placeholder (WidgetPlaceholder): the same line, the same
 * words.
 */
describe("a placeholder says it in the same line", () => {
  test.each([["en"], ["de"], ["ar"]])(
    "in %s: a sentence a widget set, in the reader's words",
    async (language: string) => {
      await speak(language);

      render(
        <WidgetPlaceholder
          icon={IconProp.List}
          message={NO_TIME_RANGE}
          messageTestId="placeholder-line"
        />,
      );

      const line: HTMLElement = screen.getByTestId("placeholder-line");

      expect(line.className).toBe(DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME);
      expect(line).toHaveTextContent(inLanguage(NO_TIME_RANGE, language));
    },
  );

  test("in ar: the server's English, set apart left to right", async () => {
    await speak("ar");

    render(
      <WidgetPlaceholder
        icon={IconProp.List}
        message={SERVER_ANSWER}
        messageTestId="placeholder-line"
      />,
    );

    const isolated: Element | null = screen
      .getByTestId("placeholder-line")
      .querySelector("bdi");

    expect(isolated).toHaveAttribute("dir", "ltr");
    expect(isolated).toHaveTextContent(SERVER_ANSWER);
  });

  test("a failure nobody explained: why, what to do next, and the reference", () => {
    render(
      <WidgetPlaceholder
        icon={IconProp.List}
        message={getUnexplainedServerErrorMessage("ab12cd34")}
        messageTestId="placeholder-line"
      />,
    );

    const line: HTMLElement = screen.getByTestId("placeholder-line");

    expect(within(line).getByTestId("error-explanation")).toBeInTheDocument();
    expect(within(line).getByTestId("error-reference")).toHaveTextContent(
      "ab12cd34",
    );
    expect(
      within(screen.getByTestId(WIDGET_PLACEHOLDER_TEST_ID)).getByTestId(
        "placeholder-line",
      ),
    ).toBe(line);
  });
});

describe("the Value widget's error, in the reader's words", () => {
  test.each([["en"], ["de"]])(
    "in %s: a failure nobody explained says why and what to do next, with its reference, as text",
    async (language: string) => {
      await speak(language);

      const unexplained: string = getUnexplainedServerErrorMessage("ab12cd34");

      fetchResultsMock.mockRejectedValue(new Error(unexplained));

      render(
        <DashboardValueComponentElement
          {...baseProps()}
          component={
            withArguments(DashboardValueComponentUtil.getDefaultComponent(), {
              metricQueryConfig: METRIC_QUERY,
            }) as never
          }
        />,
      );

      const line: HTMLElement = await screen.findByTestId(
        DASHBOARD_WIDGET_ERROR_LINE_TEST_ID,
      );

      expect(line).toHaveTextContent("ab12cd34");
      // Never the template, and never the English on a German board.
      expect(line.textContent || "").not.toContain("{{reference}}");

      if (language === "de") {
        expect(line.textContent || "").not.toMatch(
          /The server ran into a problem/,
        );
      }

      // The whole of it under the pointer, as the line is cut to its tile.
      expect(line).toHaveAttribute("title", line.textContent || "");
    },
  );
});
